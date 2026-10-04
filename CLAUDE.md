# CLAUDE.md

Janshare: app desktop (Windows) de compartilhamento de tela P2P que substitui o screen share do Discord, com visual inspirado nele. 1 transmissor + até 7 espectadores por sala, sem voz. Cloudflare Worker + Durable Object fazem **apenas signaling**; o vídeo vai direto entre os PCs via WebRTC.

Produção (signaling): https://webrtc-screen-share-mvp.scshare.workers.dev

## Estrutura
- `src/index.ts`: Worker + DO `Room` (signaling, `/ice-servers`, landing page que abre `janshare://`).
- `desktop/`: app Electron + React + TS (electron-vite). Pacote npm separado.
  - `src/main/index.ts`: janela, seletor de fontes (`desktopCapturer` + `setDisplayMediaRequestHandler`, áudio `loopback`), protocolo `janshare://`, instância única, notificações, atalho global `Ctrl+Shift+S`.
  - `src/preload/index.ts`: ponte `window.janshare` (tipos em `src/renderer/src/env.d.ts`).
  - `src/renderer/src/lib/room.ts`: `RoomClient`, toda a lógica de WebSocket/WebRTC.
  - `src/renderer/src/components/`: UI (Stage, StreamPlayer, GoLiveModal, SettingsModal).

## Comandos
Raiz (Worker): `npm run dev` (wrangler dev em :8787), `npm run deploy`, `npm run types`.
`desktop/`: `npm run dev` (app com HMR), `npm run typecheck`, `npm run build`, `npm run dist` (gera `release/Janshare Setup x.y.z.exe`).

Não há suíte de testes. Para validar: typecheck dos dois lados; para o Worker,
`node desktop/node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --lib es2022 --types ./worker-configuration.d.ts src/index.ts`.
Para testar o app contra o Worker local, mude o servidor nas Configurações para `http://127.0.0.1:8787`.

## Requisitos de produto (não quebrar)
- Sem login/cadastro; perfil (nome, cor) e salas recentes ficam no `localStorage`.
- O dono não participa das chamadas; nada pode depender de ele estar online.
- A Cloudflare **não** transporta mídia quando houver P2P. TURN é só fallback (o ICE já prefere host/srflx).
- Visual do Discord (paleta, layout rail/sidebar/stage, modal Go Live), mas **sem** logo, nome ou fonte gg sans do Discord.

## Protocolo de signaling (JSON via WS `/ws/:roomId`)
- Cliente → servidor: `hello {name,color}` (primeiro envio; reenviar atualiza o perfil), `go-live`, `stop-live`, `"ping"` (texto puro; o DO responde `"pong"` via auto-response, sem acordar).
- Servidor → cliente: `welcome {self, peers}`, `peer-joined`, `peer-updated`, `peer-left {id}`, `error {code}` (`room-full`, `already-live`).
- Relay com `to` (o servidor troca por `from`): `watch`, `unwatch`, `offer`, `answer`, `ice-candidate`.
- Só um peer pode estar `live` por sala. O espectador pede `watch` e o **transmissor cria a offer** (uma RTCPeerConnection por espectador, em malha).

## Detalhes importantes
- DO usa a WebSocket Hibernation API: estado só no `serializeAttachment` de cada socket, nunca em campos da instância.
- Transmissor: transceivers fixos [vídeo, áudio] `sendonly`, então trocar a fonte ou o áudio usa só `replaceTrack`, sem renegociar. Bitrate via `sendEncodings`/`setParameters` (`bitrateFor`).
- Reconexão: o heartbeat detecta a queda, o cliente reconecta com backoff, volta ao ar se estava transmitindo e quem assistia volta a assistir pelo nome do transmissor (janela de 60s). Os ids de peer mudam a cada conexão.
- ICE `failed` no transmissor faz `restartIce` (nova offer na mesma PC).
- TURN: defina os secrets `TURN_KEY_ID` e `TURN_KEY_API_TOKEN` (Cloudflare Realtime TURN) com `wrangler secret put`; sem eles, `/ice-servers` devolve só STUN.
- Áudio `loopback` captura todo o som do Windows (inclusive o Discord). Áudio por aplicativo exigiria um módulo nativo.
- Ícone: fonte em `desktop/resources/icon.svg`; `npm run icon` (em `desktop/`) regera `resources/icon.png`, usado pelo instalador e pela janela. O favicon da landing page (`ICON_SVG` em `src/index.ts`) é uma cópia do SVG.
- O app se chamava ScShare: o main copia `%APPDATA%\ScShare` para a pasta nova na primeira execução e o renderer renomeia as chaves `scshare.*` do `localStorage` para `janshare.*`. O subdomínio `scshare.workers.dev` é da conta Cloudflare e continua.
- Instalador sem assinatura de código: o SmartScreen avisa na primeira execução.
- `wrangler.jsonc`: migração `v1` (`new_sqlite_classes: ["Room"]`). Para mudar a classe, crie uma migração nova.
