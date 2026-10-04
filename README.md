# Janshare: compartilhamento de tela P2P

App desktop para Windows que substitui o screen share do Discord: crie uma sala, mande o link e transmita. O vídeo vai direto de um PC para o outro (WebRTC). A Cloudflare só faz o signaling.

## Uso
1. Instale `Janshare Setup x.y.z.exe` (gerado em `desktop/release/`).
2. Escolha seu nome na primeira abertura.
3. **Criar sala**: o link de convite é copiado automaticamente.
4. Quem recebe o link clica nele: a página abre o app direto na sala (`janshare://`). Também dá para colar o link ou o código na tela inicial.
5. Clique em **Compartilhar tela**, escolha a janela ou tela, a qualidade e o áudio, e clique em **Ao vivo**.
6. Os outros clicam em **Assistir transmissão**.

Até 8 pessoas por sala (1 transmitindo por vez). Atalho global: `Ctrl+Shift+S`.

## Servidor (Cloudflare)
```bash
npm install
npx wrangler login
npm run deploy
```

TURN opcional (para redes onde o P2P falha), via Cloudflare Realtime TURN:
```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

## App desktop
```bash
cd desktop
npm install
npm run dev     # desenvolvimento
npm run dist    # gera o instalador .exe em desktop/release/
```

## Limitações
- Somente Windows.
- Instalador não assinado (aviso do SmartScreen na 1ª execução).
- O áudio do sistema inclui todo o som do PC (inclusive o Discord).
- P2P em malha: cada espectador consome upload de quem transmite.
