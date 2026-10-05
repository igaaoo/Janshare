<div align="center">

<img src="desktop/resources/icon.svg" width="88" alt="Janshare" />

# Janshare

**Compartilhamento de tela P2P para Windows: crie uma sala, mande o link e transmita.**<br>
O vídeo vai direto de um computador para o outro. Sem cadastro, sem servidor de mídia, sem custo.

[**Baixar para Windows**](https://github.com/igaaoo/Janshare/releases/latest) · [Como funciona](#como-funciona) · [Segurança e privacidade](#segurança-e-privacidade) · [Desenvolvimento](#desenvolvimento)

</div>

<br>

![Janshare em uso: sala com três pessoas assistindo a uma transmissão em 1080p, com o painel de estatísticas mostrando conexão P2P direta](public/example.png)

## Funcionalidades

**Transmissão**
- **Janela ou tela inteira**, com miniaturas ao vivo no seletor.
- **Qualidade ajustável:** 720p, 1080p ou resolução original, a 15, 30 ou 60 FPS. O app estima o upload necessário antes de você entrar ao vivo.
- **Som do computador sem eco:** o áudio do sistema é transmitido **sem o som do Discord**, para quem já está na call não ouvir as vozes repetidas (captura nativa do Windows, com volta automática ao áudio completo se não for possível).
- **Troca de fonte sem derrubar ninguém:** muda de janela, de qualidade ou liga e desliga o áudio no meio da transmissão.
- **Atalho global** `Ctrl+Shift+S` para começar ou parar de transmitir de qualquer lugar.

**Assistindo**
- **Player com tela cheia, volume e "manter no topo"**, para assistir enquanto usa outro app.
- **Estatísticas em tempo real:** resolução, FPS, bitrate, latência e tipo de conexão (P2P direto ou relay).
- **Reconexão automática:** se a internet oscilar, o app reconecta sozinho e volta a assistir a mesma transmissão.

**Salas**
- **Até 8 pessoas por sala:** 1 transmitindo e até 7 assistindo.
- **Convite por link:** quem recebe clica e o app abre direto na sala (`janshare://`). Também dá para colar o link ou o código.
- **Salas recentes** na barra lateral e **perfil com nome e cor**, salvos só no seu computador.
- **Notificações** quando alguém entra, sai ou começa a transmitir.

**App**
- **Atualização automática:** novas versões baixam em segundo plano e instalam com um clique (nunca no meio de uma transmissão).
- **Sem conta e sem login:** abriu, escolheu um nome, está pronto.

## Como usar

1. Baixe o instalador na página de [Releases](https://github.com/igaaoo/Janshare/releases/latest) e execute.
   > O instalador ainda não tem assinatura digital, então o Windows SmartScreen pode avisar na primeira vez: clique em **Mais informações → Executar assim mesmo**.
2. Escolha seu nome e sua cor.
3. Clique em **+** para **criar uma sala**: o link de convite é copiado automaticamente.
4. Envie o link. Quem clicar entra direto na sala.
5. Clique em **Compartilhar tela**, escolha a janela, a qualidade e o áudio, e clique em **Ao vivo**.
6. Os outros clicam em **Assistir transmissão**.

## Como funciona

```
                 ┌──────────── Cloudflare ─────────────┐
                 │  Worker + Durable Object por sala   │
                 │  (só apresenta os participantes)    │
                 └────────▲─────────────────▲──────────┘
                 signaling │ (WebSocket)     │
                           │                 │
          ┌────────────────┴──┐         ┌────┴──────────────────┐
          │ Quem transmite    │═════════│ Quem assiste (até 7)  │
          │ Electron + React  │  vídeo  │ Electron + React      │
          └───────────────────┘   P2P   └───────────────────────┘
                              (WebRTC, direto entre os PCs)
```

- **O servidor só faz a apresentação inicial (signaling).** Um Cloudflare Worker com um Durable Object por sala troca as mensagens que os computadores precisam para se encontrar. A partir daí, **vídeo e áudio vão direto entre os PCs** via WebRTC e nunca passam pelo servidor.
- **Salas hibernam:** com a WebSocket Hibernation API, uma sala parada não consome nada. É isso que mantém o projeto com **custo zero** no plano gratuito da Cloudflare.
- **Malha (mesh):** quem transmite envia uma cópia para cada espectador. Por isso o limite de 8 pessoas: o upload de quem transmite é o recurso que escala.
- **Troca de fonte sem renegociar:** os canais de vídeo e áudio ficam fixos e a fonte é trocada com `replaceTrack`; a qualidade é ajustada por `setParameters`.

**Stack:** Electron, React e TypeScript (electron-vite) no app; Cloudflare Workers e Durable Objects no servidor; um helper nativo em C++ (WASAPI *process loopback*) para o áudio.

## Segurança e privacidade

**O que fica protegido**
- **Mídia criptografada de ponta a ponta:** WebRTC usa DTLS-SRTP. Nem o servidor nem o provedor de internet conseguem ver o vídeo.
- **Nada é armazenado:** o servidor não guarda vídeo, áudio, mensagens nem histórico. Perfil e salas recentes ficam só no seu computador.
- **Salas por convite:** não existe busca nem lista de salas públicas. Os códigos gerados pelo app têm 96 bits aleatórios, impossíveis de adivinhar.
- **Câmera e microfone sempre bloqueados:** o app só tem permissão para capturar a tela que você escolher. Nenhuma página consegue ligar sua câmera ou seu microfone.
- **Você decide o que transmite:** nada vai ao ar sem você escolher a fonte no seletor. Links e atalhos nunca iniciam uma transmissão sozinhos.

**Como o app se protege**
- **Interface isolada:** sandbox do Chromium, `contextIsolation` e sem acesso a Node.js na interface; a ponte com o sistema expõe só ações específicas. O app não navega para fora nem abre janelas.
- **Mensagens validadas nas duas pontas:** o servidor repassa só campos conhecidos e com formato válido; o app valida de novo antes de usar.
- **Limites contra abuso:** limite de mensagens por conexão e fila limitada de candidatos de conexão, para ninguém travar o app de outra pessoa.
- **Sem falsificação de identidade:** o remetente de cada mensagem é definido pelo servidor, e a reconexão automática reconhece o transmissor por uma chave derivada de um segredo da sessão, não pelo nome (que qualquer um poderia copiar). Nomes passam por limpeza de caracteres invisíveis.

**O que você precisa saber**
- **Quem está na sua sala vê seu IP público** quando a conexão de vídeo é estabelecida. É assim que o P2P funciona. Compartilhe salas só com quem você conhece.
- **Quem tem o link pode entrar.** O app avisa quando alguém começa a assistir.
- **O áudio do sistema inclui tudo o que toca no PC**, exceto o Discord. Feche o que não quiser transmitir.
- **Estatísticas anônimas de uso** (contagem de instalações, sessões e transmissões) são enviadas sem nome, IP ou conteúdo; o identificador da instalação é aleatório e só é guardado como hash.

## Uso responsável

O Janshare é destinado a **maiores de 18 anos**, para compartilhar a tela com pessoas que você conhece. É proibido usá-lo para transmitir conteúdo ilegal ou para contato com menores de idade. Para reportar abuso, abra uma [issue](https://github.com/igaaoo/Janshare/issues).

## Desenvolvimento

Pré-requisitos: Node.js 20+ e Windows 10 (versão 2004) ou mais novo. O Visual Studio com C++ só é necessário para recompilar o helper de áudio.

**Servidor** (raiz do projeto)
```bash
npm install
npm run dev       # Worker local em http://127.0.0.1:8787
npm run deploy    # publica na Cloudflare (npx wrangler login na primeira vez)
```

**App desktop**
```bash
cd desktop
npm install
npm run dev        # app com recarga automática
npm run typecheck
npm run dist       # gera desktop/release/Janshare-Setup-x.y.z.exe
npm run native     # recompila o helper de áudio (opcional)
```

Para testar o app contra o servidor local, troque o servidor nas **Configurações** para `http://127.0.0.1:8787`.

**TURN (opcional):** para redes em que a conexão direta falha, configure o Cloudflare Realtime TURN. Sem isso, o app usa só STUN, e o vídeo nunca passa pelo servidor.
```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

**Publicar uma versão**
1. Aumente `version` em `desktop/package.json`.
2. Crie `desktop/electron-builder.env` com `GH_TOKEN=...`: um token do GitHub com **Contents: Read and write** neste repositório. O arquivo é ignorado pelo Git.
3. Rode `npm run release` em `desktop/`. O script publica o instalador nos Releases, e os apps instalados se atualizam sozinhos.

## Limitações

- Somente Windows (10 versão 2004 ou mais novo para o áudio sem o Discord).
- Instalador sem assinatura digital: aviso do SmartScreen na primeira execução.
- Sem TURN, algumas redes muito restritivas (alguns 4G e CGNAT) não conseguem a conexão direta.
- Malha P2P: com muitos espectadores em alta qualidade, o upload de quem transmite é o limite.
