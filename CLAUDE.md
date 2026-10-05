# CLAUDE.md

Janshare: app desktop (Windows) de compartilhamento de tela P2P para grupos pequenos de pessoas que se conhecem, gratuito e open source. 1 transmissor + até 7 espectadores por sala, sem voz. Cloudflare Worker + Durable Object fazem **apenas signaling**; o vídeo vai direto entre os PCs via WebRTC.

Produção (signaling): https://janshare.igaaoo.workers.dev

## Estrutura
- `src/index.ts`: Worker + DO `Room` (signaling, `/ice-servers`, landing page que abre `janshare://`).
- `src/stats.ts`: DO `Stats` (instância única "global", SQLite) com estatísticas anônimas; `src/stats-page.ts`: página pública `/stats` (dados brutos em `/stats.json`).
- `desktop/`: app Electron + React + TS (electron-vite). Pacote npm separado.
  - `src/main/index.ts`: janela, seletor de fontes (`desktopCapturer` + `setDisplayMediaRequestHandler`, áudio `loopback`), protocolo `janshare://`, instância única, notificações, atalho global `Ctrl+Shift+S`.
  - `src/preload/index.ts`: ponte `window.janshare` (tipos em `src/renderer/src/env.d.ts`).
  - `src/renderer/src/lib/room.ts`: `RoomClient`, toda a lógica de WebSocket/WebRTC.
  - `src/renderer/src/components/`: UI (Stage, StreamPlayer, GoLiveModal, SettingsModal).

## Comandos
Raiz (Worker): `npm run dev` (wrangler dev em :8787), `npm run deploy`, `npm run types`.
`desktop/`: `npm run dev` (app com HMR), `npm run typecheck`, `npm run build`, `npm run dist` (gera `release/Janshare-Setup-x.y.z.exe` sem publicar), `npm run release` (build + `scripts/release.mjs`, que publica no GitHub Releases; token em `GH_TOKEN` ou `desktop/electron-builder.env`; `node scripts/release.mjs --dry-run` só confere).

Não há suíte de testes. Para validar: typecheck dos dois lados; para o Worker,
`node desktop/node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --lib es2022 --types ./worker-configuration.d.ts src/index.ts`.
Para testar o app contra o Worker local, mude o servidor nas Configurações para `http://127.0.0.1:8787`.

## Requisitos de produto (não quebrar)
- Sem login/cadastro; perfil (nome, cor) e salas recentes ficam no `localStorage`.
- O dono não participa das chamadas; nada pode depender de ele estar online.
- A Cloudflare **não** transporta mídia quando houver P2P. TURN é só fallback (o ICE já prefere host/srflx).
- Visual inspirado no Discord (paleta, layout rail/sidebar/stage, modal de transmissão), mas **sem** logo, nome ou fonte gg sans do Discord.
- Salas só por convite: nunca criar busca, lista de salas públicas ou pareamento com desconhecidos.
- Uso destinado a maiores de 18 anos (README, seção "Uso responsável").

## Posicionamento (cuidado jurídico)
Em agosto de 2026 a ANPD suspendeu no Brasil o Go Live, as chamadas de vídeo e o compartilhamento de tela do Discord com base no ECA Digital (Lei 15.211/2025, proteção de crianças e adolescentes; multas de até R$ 50 milhões). Por isso:
- **Nunca** apresentar o Janshare como substituto do Discord, do Go Live ou como forma de contornar a suspensão (README, textos do app, landing page, releases, commits). Descrever como "compartilhamento de tela P2P para equipes e amigos".
- Citar o Discord só quando for fato técnico (ex.: o áudio exclui o som do Discord).
- Novos recursos que aumentem o alcance a desconhecidos (salas públicas, descoberta, chat com estranhos) exigem rever as obrigações do ECA Digital antes.

## Protocolo de signaling (JSON via WS `/ws/:roomId`)
- Cliente → servidor: `hello {name,color,secret}` (primeiro envio; reenviar atualiza nome/cor, mas não a key). O servidor publica `key` = hash SHA-256 do `secret` em cada peer; o segredo nunca sai do servidor, `go-live`, `stop-live`, `"ping"` (texto puro; o DO responde `"pong"` via auto-response, sem acordar).
- Servidor → cliente: `welcome {self, peers}`, `peer-joined`, `peer-updated`, `peer-left {id}`, `error {code}` (`room-full`, `already-live`).
- Relay com `to` (o servidor troca por `from`): `watch`, `unwatch`, `offer`, `answer`, `ice-candidate`. O servidor repassa só os campos conhecidos (`relayPayload`) e descarta formatos inválidos; o cliente valida de novo (`isSdp`/`isCandidate`).
- Segurança: rate limit por socket (token bucket, 300 de rajada, 50/s) no attachment; nomes sem caracteres de controle/direção; fila de ICE pendente limitada a 50 e só para peers com conexão; microfone/câmera sempre negados no main (só `media` com `mediaTypes` vazio, que é o `getDisplayMedia`).
- Só um peer pode estar `live` por sala. O espectador pede `watch` e o **transmissor cria a offer** (uma RTCPeerConnection por espectador, em malha).

## Detalhes importantes
- DO usa a WebSocket Hibernation API: estado só no `serializeAttachment` de cada socket, nunca em campos da instância.
- Transmissor: transceivers fixos [vídeo, áudio] `sendonly`, então trocar a fonte ou o áudio usa só `replaceTrack`, sem renegociar. Bitrate via `sendEncodings`/`setParameters` (`bitrateFor`).
- Reconexão: o heartbeat detecta a queda, o cliente reconecta com backoff, volta ao ar se estava transmitindo e quem assistia volta a assistir o transmissor com a mesma `key` (janela de 60s; nunca pelo nome, que pode ser copiado). Os ids de peer mudam a cada conexão.
- ICE `failed` no transmissor faz `restartIce` (nova offer na mesma PC).
- TURN: defina os secrets `TURN_KEY_ID` e `TURN_KEY_API_TOKEN` (Cloudflare Realtime TURN) com `wrangler secret put`; sem eles, `/ice-servers` devolve só STUN.
- Áudio: o helper nativo `desktop/native/audio-capture.cpp` (process loopback do Windows 10 2004+) captura todo o som **exceto a árvore de processos do Discord** e escreve PCM s16le/estéreo/48 kHz no stdout. O main o roda por contagem de referências (`audio:start`/`audio:stop`) e repassa os chunks (`audio:chunk`); `lib/audio.ts` + `public/pcm-worklet.js` viram uma faixa WebRTC. Se o helper falhar, `capture()` cai no `loopback` do Chromium (todo o som) e avisa. O `.exe` fica versionado em `resources/`; recompile com `npm run native` (precisa do VS com C++). O helper sai sozinho quando o stdin fecha.
- Ícone: fonte em `desktop/resources/icon.svg`; `npm run icon` (em `desktop/`) regera `resources/icon.png`, usado pelo instalador e pela janela. O favicon da landing page (`ICON_SVG` em `src/index.ts`) é uma cópia do SVG.
- O app se chamava ScShare: o main copia `%APPDATA%\ScShare` para a pasta nova na primeira execução e o renderer renomeia as chaves `scshare.*` do `localStorage` para `janshare.*`. O servidor era `webrtc-screen-share-mvp.scshare.workers.dev`; `LEGACY_SERVERS` em `settings.ts` troca esse endereço salvo pelo novo.
- Instalador sem assinatura de código: o SmartScreen avisa na primeira execução.
- Estatísticas: o `hello` leva `install` (id aleatório da instalação, em `localStorage` `janshare.installId`) e `version` (`__APP_VERSION__`, definido no `electron.vite.config.ts`). O `Room` guarda país (header `x-janshare-country`, posto pelo Worker a partir de `request.cf`), início da sessão/transmissão/assistir no attachment e chama o `Stats` por RPC (`join`, `leave`, `streamStarted/Ended`, `watchStarted/Ended`) sem bloquear o signaling (`track`). Tudo são contadores incrementais; o resumo fica 5 min em cache na memória do `Stats` e só o "online agora" é recalculado a cada leitura. Nunca guardar nome, IP ou id de sala legível.
- `wrangler.jsonc`: migrações `v1` (`Room`) e `v2` (`Stats`), ambas `new_sqlite_classes`. Para mudar uma classe, crie uma migração nova.
- Atualização automática: `electron-updater` com `publish: github` (`igaaoo/Janshare`, `releaseType: release`) no `electron-builder.yml`. O main checa ao abrir e a cada 4 h (só empacotado), baixa em segundo plano e avisa o renderer (`update:ready`); o banner oferece "Reiniciar" (`update:install` → `quitAndInstall`), escondido durante uma transmissão; senão instala ao fechar. Sempre aumente `version` no `desktop/package.json` antes de `npm run release`. Não use `--publish always` do electron-builder: ele cria dois publicadores em paralelo e falha com 422 `already_exists`; o `release.mjs` cria o release como rascunho, sobe os 3 arquivos em sequência (confere o hash do `latest.yml`) e só então publica. O nome do instalador não pode ter espaços (`artifactName`), senão não bate com o `latest.yml`.
