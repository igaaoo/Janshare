import { DurableObject } from "cloudflare:workers";

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  // Opcionais: Cloudflare Realtime TURN. Sem eles, o app usa só STUN.
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

// 1 transmissor + até 7 espectadores. P2P em malha: cada espectador
// consome upload de quem transmite, então não adianta subir muito.
const MAX_PEERS = 8;
const ROOM_ID = /^[a-zA-Z0-9_-]{6,64}$/;
const PROTOCOL = "janshare";
// Mesmo desenho de desktop/resources/icon.svg.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="115" fill="#5865F2"/><g fill="#fff"><rect x="96" y="110" width="320" height="216" rx="44"/><rect x="230" y="318" width="52" height="54"/><rect x="166" y="362" width="180" height="40" rx="20"/></g><g fill="#5865F2"><ellipse cx="203" cy="218" rx="30" ry="36"/><ellipse cx="309" cy="218" rx="30" ry="36"/></g></svg>`;

const STUN_ONLY = [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }];

type Attachment = {
  id: string;
  name: string;
  color: string;
  live: boolean;
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS"
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS }
  });
}

async function iceServers(env: Env): Promise<unknown[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY;

  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ ttl: 86400 })
    }
  );

  if (!res.ok) {
    console.error("TURN credentials error:", res.status, await res.text());
    return STUN_ONLY;
  }

  const data = (await res.json()) as { iceServers: unknown };
  // A API pode devolver um objeto ou uma lista.
  return Array.isArray(data.iceServers) ? data.iceServers : [...STUN_ONLY, data.iceServers];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

// Página para quem abre o link no navegador: tenta abrir o app desktop.
function landingPage(roomId: string | null): string {
  const deepLink = roomId ? `${PROTOCOL}://room/${roomId}` : `${PROTOCOL}://`;
  const safeLink = escapeHtml(deepLink);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Janshare</title>
  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent(ICON_SVG)}" />
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: "Noto Sans", "Segoe UI", system-ui, sans-serif;
      background: #313338; color: #dbdee1;
    }
    .card { background: #2b2d31; padding: 32px; border-radius: 8px; width: min(440px, 90vw); text-align: center; }
    h1 { color: #f2f3f5; font-size: 24px; margin: 0 0 8px; }
    p { color: #b5bac1; line-height: 1.5; }
    a.button {
      display: inline-block; margin-top: 12px; padding: 10px 24px; border-radius: 4px;
      background: #5865f2; color: #fff; text-decoration: none; font-weight: 600;
    }
    a.button:hover { background: #4752c4; }
    code { background: #1e1f22; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${roomId ? "Você foi convidado para uma transmissão" : "Janshare"}</h1>
    <p>${roomId ? `Sala <code>${escapeHtml(roomId)}</code>` : "Compartilhamento de tela P2P."}</p>
    <a class="button" href="${safeLink}">Abrir no app</a>
    <p>Ainda não tem o app? Peça o instalador para quem te enviou o link.</p>
  </div>
  ${roomId ? `<script>location.href = ${JSON.stringify(deepLink)};</script>` : ""}
</body>
</html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname === "/ice-servers") {
      return json({ iceServers: await iceServers(env) });
    }

    if (url.pathname.startsWith("/ws/")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const roomId = decodeURIComponent(url.pathname.slice("/ws/".length));

      if (!ROOM_ID.test(roomId)) {
        return new Response("Invalid room", { status: 400 });
      }

      return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(request);
    }

    const match = url.pathname.match(/^\/room\/([^/]+)$/);
    const roomId = match && ROOM_ID.test(match[1]) ? match[1] : null;

    return new Response(landingPage(roomId), {
      headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store" }
    });
  }
};

/**
 * Signaling de uma sala. Usa a WebSocket Hibernation API: nenhum estado em
 * campos da instância, tudo fica no attachment de cada socket.
 *
 * Protocolo (JSON):
 *   servidor → cliente: welcome {self, peers}, peer-joined {peer}, peer-left {id},
 *                       peer-updated {peer}, error {code, message}
 *   cliente → servidor: hello {name, color}, go-live, stop-live
 *   relay (com `to`):   watch, unwatch, offer, answer, ice-candidate
 *                       o servidor troca `to` por `from` ao entregar.
 */
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat do cliente respondido sem acordar o DO.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    if (this.ctx.getWebSockets().length > MAX_PEERS) {
      server.send(JSON.stringify({ type: "error", code: "room-full", message: "A sala está cheia." }));
      server.close(4000, "room-full");
    } else {
      const attachment: Attachment = { id: crypto.randomUUID(), name: "", color: "", live: false };
      server.serializeAttachment(attachment);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private info(ws: WebSocket): Attachment | null {
    return ws.deserializeAttachment() as Attachment | null;
  }

  private peers(): Array<{ ws: WebSocket; info: Attachment }> {
    const result = [];
    for (const ws of this.ctx.getWebSockets()) {
      const info = this.info(ws);
      // Sockets sem nome ainda não mandaram `hello`.
      if (info?.name && ws.readyState === WebSocket.OPEN) result.push({ ws, info });
    }
    return result;
  }

  private broadcast(message: unknown, except?: WebSocket) {
    const data = JSON.stringify(message);
    for (const { ws } of this.peers()) {
      if (ws !== except) ws.send(data);
    }
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 64 * 1024) return;

    const info = this.info(ws);
    if (!info) return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    switch (message.type) {
      case "hello": {
        const firstHello = !info.name;
        info.name = String(message.name ?? "").trim().slice(0, 32) || "Anônimo";
        info.color = /^#[0-9a-f]{6}$/i.test(String(message.color)) ? String(message.color) : "#5865f2";
        ws.serializeAttachment(info);

        ws.send(JSON.stringify({
          type: "welcome",
          self: info,
          peers: this.peers().filter(p => p.ws !== ws).map(p => p.info)
        }));

        this.broadcast({ type: firstHello ? "peer-joined" : "peer-updated", peer: info }, ws);
        return;
      }

      case "go-live": {
        if (!info.name) return;
        const other = this.peers().find(p => p.info.live && p.ws !== ws);
        if (other) {
          ws.send(JSON.stringify({
            type: "error",
            code: "already-live",
            message: `${other.info.name} já está transmitindo.`
          }));
          return;
        }
        info.live = true;
        ws.serializeAttachment(info);
        this.broadcast({ type: "peer-updated", peer: info });
        return;
      }

      case "stop-live": {
        if (!info.live) return;
        info.live = false;
        ws.serializeAttachment(info);
        this.broadcast({ type: "peer-updated", peer: info });
        return;
      }

      case "watch":
      case "unwatch":
      case "offer":
      case "answer":
      case "ice-candidate": {
        const target = this.peers().find(p => p.info.id === message.to);
        if (!target || !info.name) return;
        const { to: _to, ...rest } = message;
        target.ws.send(JSON.stringify({ ...rest, from: info.id }));
        return;
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    const info = this.info(ws);
    if (info?.name) this.broadcast({ type: "peer-left", id: info.id }, ws);

    try {
      ws.close(code, reason);
    } catch {}
  }

  webSocketError(ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);
  }
}
