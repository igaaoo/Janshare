import { DurableObject } from "cloudflare:workers";
import { Stats } from "./stats";
import { statsPage } from "./stats-page";

export { Stats };

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  STATS: DurableObjectNamespace<Stats>;
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
  // Hash do segredo que o cliente manda no hello: identifica a mesma pessoa entre
  // reconexões (os ids mudam) sem que outro peer consiga copiar.
  key: string;
  // Limite de mensagens (token bucket) para um peer não inundar os outros.
  tokens: number;
  at: number;
  // Estatísticas (ver stats.ts): país (da Cloudflare), início da sessão, da
  // transmissão e de quem está assistindo.
  country: string;
  joinedAt: number;
  liveSince: number;
  watching: string;
  watchSince: number;
};

const RATE_BURST = 300;
const RATE_PER_SECOND = 50;
const RELAY_TYPES = new Set(["watch", "unwatch", "offer", "answer", "ice-candidate"]);

// Remove caracteres de controle e de direção (RTL override etc.), usados para disfarçar nomes.
function cleanName(value: unknown): string {
  return String(value ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .slice(0, 32);
}

async function keyFor(secret: unknown): Promise<string> {
  if (typeof secret !== "string" || secret.length < 16 || secret.length > 128) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest).slice(0, 16)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function takeToken(info: Attachment): boolean {
  const now = Date.now();
  // `??`: sockets abertos antes do deploy não têm esses campos.
  info.tokens = Math.min(RATE_BURST, (info.tokens ?? RATE_BURST) + ((now - (info.at ?? now)) / 1000) * RATE_PER_SECOND);
  info.at = now;
  if (info.tokens < 1) return false;
  info.tokens -= 1;
  return true;
}

/** Campos que vão para o outro peer; o resto da mensagem é descartado. */
function relayPayload(message: Record<string, unknown>): Record<string, unknown> | null {
  switch (message.type) {
    case "watch":
    case "unwatch":
      return { type: message.type };
    case "offer":
    case "answer": {
      const sdp = message.sdp as { type?: unknown; sdp?: unknown } | null;
      if (!sdp || sdp.type !== message.type || typeof sdp.sdp !== "string") return null;
      return { type: message.type, sdp: { type: sdp.type, sdp: sdp.sdp } };
    }
    case "ice-candidate": {
      const c = message.candidate as { candidate?: unknown; sdpMid?: unknown; sdpMLineIndex?: unknown } | null;
      if (!c || typeof c.candidate !== "string" || c.candidate.length > 1024) return null;
      return {
        type: "ice-candidate",
        candidate: {
          candidate: c.candidate,
          sdpMid: typeof c.sdpMid === "string" ? c.sdpMid : null,
          sdpMLineIndex: typeof c.sdpMLineIndex === "number" ? c.sdpMLineIndex : null
        }
      };
    }
  }
  return null;
}

/** O que os outros peers enxergam (sem o estado interno do rate limit). */
function publicPeer({ id, name, color, live, key }: Attachment) {
  return { id, name, color, live, key };
}

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

export type PageLanguage = "en" | "pt";

const DOWNLOAD_URL = "https://github.com/igaaoo/Janshare/releases/latest";

/** Idioma das páginas: `?lang=en|pt` ou o Accept-Language do navegador (pt-* → português). */
function pageLanguage(request: Request, url: URL): PageLanguage {
  const forced = url.searchParams.get("lang");
  if (forced === "en" || forced === "pt") return forced;
  return /^\s*pt\b/i.test(request.headers.get("accept-language") ?? "") ? "pt" : "en";
}

const LANDING_TEXT = {
  en: {
    invited: "You've been invited to a stream",
    room: "Room",
    tagline: "Lightweight peer-to-peer screen sharing.",
    open: "Open in the app",
    noApp: "Don't have the app yet?",
    download: "Download Janshare for Windows"
  },
  pt: {
    invited: "Você foi convidado para uma transmissão",
    room: "Sala",
    tagline: "Compartilhamento de tela P2P leve.",
    open: "Abrir no app",
    noApp: "Ainda não tem o app?",
    download: "Baixe o Janshare para Windows"
  }
} satisfies Record<PageLanguage, Record<string, string>>;

// Página para quem abre o link no navegador: tenta abrir o app desktop.
function landingPage(roomId: string | null, language: PageLanguage): string {
  const deepLink = roomId ? `${PROTOCOL}://room/${roomId}` : `${PROTOCOL}://`;
  const safeLink = escapeHtml(deepLink);
  const text = LANDING_TEXT[language];

  return `<!doctype html>
<html lang="${language === "pt" ? "pt-BR" : "en"}">
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
    p a { color: #00a8fc; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${roomId ? text.invited : "Janshare"}</h1>
    <p>${roomId ? `${text.room} <code>${escapeHtml(roomId)}</code>` : text.tagline}</p>
    <a class="button" href="${safeLink}">${text.open}</a>
    <p>${text.noApp} <a href="${DOWNLOAD_URL}">${text.download}</a>.</p>
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

    if (url.pathname === "/stats" || url.pathname === "/stats.json") {
      const summary = await env.STATS.get(env.STATS.idFromName("global")).summary();
      if (url.pathname === "/stats.json") return json(summary);
      return new Response(statsPage(summary, ICON_SVG, pageLanguage(request, url)), {
        headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store" }
      });
    }

    if (url.pathname.startsWith("/ws/")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const roomId = decodeURIComponent(url.pathname.slice("/ws/".length));

      if (!ROOM_ID.test(roomId)) {
        return new Response("Invalid room", { status: 400 });
      }

      // O país vem da Cloudflare (nunca do cliente) e vai só para as estatísticas.
      const forwarded = new Request(request);
      forwarded.headers.set("x-janshare-country", String(request.cf?.country ?? "XX"));
      return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(forwarded);
    }

    const match = url.pathname.match(/^\/room\/([^/]+)$/);
    const roomId = match && ROOM_ID.test(match[1]) ? match[1] : null;

    return new Response(landingPage(roomId, pageLanguage(request, url)), {
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
      const attachment: Attachment = {
        id: crypto.randomUUID(),
        name: "",
        color: "",
        live: false,
        key: "",
        tokens: RATE_BURST,
        at: Date.now(),
        country: request.headers.get("x-janshare-country") ?? "XX",
        joinedAt: 0,
        liveSince: 0,
        watching: "",
        watchSince: 0
      };
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

  /** Registra um evento nas estatísticas sem atrasar nem derrubar o signaling. */
  private track(event: (stats: DurableObjectStub<Stats>) => Promise<unknown>) {
    event(this.env.STATS.get(this.env.STATS.idFromName("global"))).catch(error => console.error("stats:", error));
  }

  // No webSocketClose o socket já está fechando e gravar o attachment pode falhar.
  private save(ws: WebSocket, info: Attachment) {
    try {
      ws.serializeAttachment(info);
    } catch {}
  }

  private endWatch(ws: WebSocket, info: Attachment) {
    if (!info.watching) return;
    const seconds = (Date.now() - info.watchSince) / 1000;
    info.watching = "";
    info.watchSince = 0;
    this.save(ws, info);
    this.track(stats => stats.watchEnded(seconds));
  }

  /** Fim da transmissão: fecha também o tempo de quem estava assistindo. */
  private endStream(ws: WebSocket, info: Attachment) {
    if (!info.liveSince) return;
    const seconds = (Date.now() - info.liveSince) / 1000;
    info.liveSince = 0;
    this.save(ws, info);
    this.track(stats => stats.streamEnded(seconds));
    for (const peer of this.peers()) {
      if (peer.info.watching === info.id) this.endWatch(peer.ws, peer.info);
    }
  }

  private broadcast(message: unknown, except?: WebSocket) {
    const data = JSON.stringify(message);
    for (const { ws } of this.peers()) {
      if (ws !== except) ws.send(data);
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 64 * 1024) return;

    const info = this.info(ws);
    if (!info) return;

    // Acima do limite a mensagem é descartada em silêncio.
    const allowed = takeToken(info);
    ws.serializeAttachment(info);
    if (!allowed) return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;

    switch (message.type) {
      case "hello": {
        const firstHello = !info.name;
        info.name = cleanName(message.name) || "Anônimo";
        info.color = /^#[0-9a-f]{6}$/i.test(String(message.color)) ? String(message.color) : "#5865f2";
        // A identidade não muda durante a conexão: um hello posterior não troca a key.
        if (firstHello) {
          info.key = await keyFor(message.secret);
          info.joinedAt = Date.now();
        }
        ws.serializeAttachment(info);

        ws.send(JSON.stringify({
          type: "welcome",
          self: publicPeer(info),
          peers: this.peers().filter(p => p.ws !== ws).map(p => publicPeer(p.info))
        }));

        this.broadcast({ type: firstHello ? "peer-joined" : "peer-updated", peer: publicPeer(info) }, ws);

        if (firstHello) {
          const install = await keyFor(message.install);
          const online = this.peers().length;
          this.track(stats =>
            stats.join({
              install,
              version: String(message.version ?? ""),
              country: info.country ?? "XX",
              room: this.ctx.id.toString(),
              online
            })
          );
        }
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
        if (!info.liveSince) {
          info.liveSince = Date.now();
          this.track(stats => stats.streamStarted());
        }
        ws.serializeAttachment(info);
        this.broadcast({ type: "peer-updated", peer: publicPeer(info) });
        return;
      }

      case "stop-live": {
        if (!info.live) return;
        info.live = false;
        ws.serializeAttachment(info);
        this.endStream(ws, info);
        this.broadcast({ type: "peer-updated", peer: publicPeer(info) });
        return;
      }

      default: {
        if (!RELAY_TYPES.has(String(message.type)) || !info.name) return;
        const target = this.peers().find(p => p.info.id === message.to && p.ws !== ws);
        const payload = relayPayload(message);
        if (!target || !payload) return;
        target.ws.send(JSON.stringify({ ...payload, from: info.id }));

        if (message.type === "watch" && target.info.live && info.watching !== target.info.id) {
          this.endWatch(ws, info);
          info.watching = target.info.id;
          info.watchSince = Date.now();
          ws.serializeAttachment(info);
          this.track(stats => stats.watchStarted());
        } else if (message.type === "unwatch" && info.watching === target.info.id) {
          this.endWatch(ws, info);
        }
        return;
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    const info = this.info(ws);
    if (info?.name) {
      this.broadcast({ type: "peer-left", id: info.id }, ws);
      this.endStream(ws, info);
      this.endWatch(ws, info);
      const seconds = (Date.now() - info.joinedAt) / 1000;
      const online = this.peers().length;
      this.track(stats => stats.leave({ room: this.ctx.id.toString(), online, seconds }));
    }

    try {
      ws.close(code, reason);
    } catch {}
  }

  webSocketError(ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);
  }
}
