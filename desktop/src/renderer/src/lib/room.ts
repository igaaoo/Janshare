import { startSystemAudio, type SystemAudio } from "./audio";
import type { Profile } from "./settings";

// key: hash (feito pelo servidor) do segredo de cada cliente; igual entre reconexões.
export type Peer = { id: string; name: string; color: string; live: boolean; key?: string };

export type Resolution = "720p" | "1080p" | "source";
export type FrameRate = 15 | 30 | 60;

export type StreamSettings = {
  sourceId: string;
  sourceName: string;
  audio: boolean;
  resolution: Resolution;
  fps: FrameRate;
};

export type Route = "direct" | "relay" | "unknown";

export type ViewerStats = { kbps: number; fps: number; width: number; height: number; rttMs: number | null; route: Route };
export type StreamerStats = { kbps: number; viewers: Array<{ id: string; route: Route }> };

export type RoomStatus = "connecting" | "connected" | "reconnecting" | "full" | "closed";

export type RoomSnapshot = {
  roomId: string;
  status: RoomStatus;
  self: Peer | null;
  peers: Peer[];
  // Transmitindo
  localStream: MediaStream | null;
  streamSettings: StreamSettings | null;
  streamerStats: StreamerStats | null;
  // Assistindo
  watching: string | null;
  remoteStream: MediaStream | null;
  remoteState: RTCPeerConnectionState | "waiting";
  viewerStats: ViewerStats | null;
};

export type RoomEvent =
  | { type: "peer-joined"; peer: Peer }
  | { type: "peer-left"; peer: Peer }
  | { type: "live-started"; peer: Peer }
  | { type: "viewer-joined"; peer: Peer }
  | { type: "error"; message: string };

const RESOLUTIONS: Record<Resolution, { width?: number; height?: number; bitrate: number }> = {
  "720p": { width: 1280, height: 720, bitrate: 2_500_000 },
  "1080p": { width: 1920, height: 1080, bitrate: 4_500_000 },
  source: { bitrate: 8_000_000 }
};

/** Bitrate máximo de vídeo por espectador, em bits/s. */
export function bitrateFor(settings: Pick<StreamSettings, "resolution" | "fps">): number {
  const factor = settings.fps === 60 ? 1.5 : settings.fps === 15 ? 0.6 : 1;
  return Math.round(RESOLUTIONS[settings.resolution].bitrate * factor);
}

const FALLBACK_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const HEARTBEAT_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 40_000;
const REWATCH_WINDOW_MS = 60_000;
const MAX_PENDING_ICE = 50;
const MAX_SDP_LENGTH = 64 * 1024;

function makeSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// Id aleatório desta instalação, só para contar usuários únicos (o servidor guarda o hash).
const INSTALL_KEY = "janshare.installId";
function installId(): string {
  let id = localStorage.getItem(INSTALL_KEY);
  if (!id) {
    id = makeSecret();
    localStorage.setItem(INSTALL_KEY, id);
  }
  return id;
}

function isSdp(value: unknown, type: "offer" | "answer"): value is RTCSessionDescriptionInit {
  const sdp = value as RTCSessionDescriptionInit | null;
  return !!sdp && sdp.type === type && typeof sdp.sdp === "string" && sdp.sdp.length <= MAX_SDP_LENGTH;
}

function isCandidate(value: unknown): value is RTCIceCandidateInit {
  const candidate = value as RTCIceCandidateInit | null;
  return !!candidate && typeof candidate.candidate === "string" && candidate.candidate.length <= 1024;
}

type Options = {
  server: string;
  roomId: string;
  profile: Profile;
  onChange(snapshot: RoomSnapshot): void;
  onEvent(event: RoomEvent): void;
};

type Signal = Record<string, any> & { type: string; from?: string };

/**
 * Uma sala: WebSocket de signaling + conexões WebRTC.
 *
 * Quem transmite mantém uma RTCPeerConnection por espectador (malha). Quem
 * assiste mantém uma só, com o transmissor. O espectador pede com `watch` e o
 * transmissor responde com a offer, como o "Assistir transmissão" do Discord.
 */
export class RoomClient {
  private opts: Options;
  private ws: WebSocket | null = null;
  private left = false;
  private retry = 0;
  private retryTimer: number | undefined;
  private heartbeatTimer: number | undefined;
  private statsTimer: number | undefined;
  private lastPong = 0;
  private iceServers: RTCIceServer[] = FALLBACK_ICE;

  private sendPcs = new Map<string, RTCPeerConnection>();
  private recv: { peerId: string; pc: RTCPeerConnection } | null = null;
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private lastBytes = new Map<string, { bytes: number; time: number }>();
  // Capturador nativo do som (sem o Discord) da transmissão atual.
  private systemAudio: SystemAudio | null = null;

  // Para voltar a assistir sozinho se o transmissor cair e voltar.
  // Compara pela key (que ninguém consegue copiar), não pelo nome.
  private rewatch: { key: string; until: number } | null = null;
  // Segredo desta sessão: o servidor publica só o hash (Peer.key).
  private readonly secret = makeSecret();

  private state: RoomSnapshot;

  constructor(opts: Options) {
    this.opts = opts;
    this.state = {
      roomId: opts.roomId,
      status: "connecting",
      self: null,
      peers: [],
      localStream: null,
      streamSettings: null,
      streamerStats: null,
      watching: null,
      remoteStream: null,
      remoteState: "waiting",
      viewerStats: null
    };
  }

  get snapshot(): RoomSnapshot {
    return this.state;
  }

  private patch(update: Partial<RoomSnapshot>) {
    this.state = { ...this.state, ...update };
    this.opts.onChange(this.state);
  }

  private peer(id: string): Peer | undefined {
    return this.state.peers.find(p => p.id === id);
  }

  // ---------------------------------------------------------------- conexão

  async start() {
    this.patch({ status: "connecting" });
    await this.loadIceServers();
    if (!this.left) this.open();
    this.statsTimer = window.setInterval(() => void this.collectStats(), 1000);
  }

  private async loadIceServers() {
    try {
      const res = await fetch(`${this.opts.server}/ice-servers`);
      const data = await res.json();
      if (Array.isArray(data.iceServers) && data.iceServers.length) this.iceServers = data.iceServers;
    } catch (error) {
      console.warn("ICE servers indisponíveis, usando STUN padrão", error);
    }
  }

  private open() {
    const url = `${this.opts.server.replace(/^http/, "ws")}/ws/${encodeURIComponent(this.opts.roomId)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.lastPong = Date.now();
      this.sendHello();
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = window.setInterval(() => {
        if (Date.now() - this.lastPong > HEARTBEAT_TIMEOUT_MS) {
          this.disconnected(ws);
          return;
        }
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, HEARTBEAT_MS);
    };

    ws.onmessage = event => {
      if (event.data === "pong") {
        this.lastPong = Date.now();
        return;
      }
      try {
        this.onSignal(JSON.parse(event.data)).catch(error => console.warn("Falha ao tratar sinal", error));
      } catch (error) {
        console.error("Mensagem inválida", error);
      }
    };

    ws.onclose = () => this.disconnected(ws);
  }

  /** Socket caiu (ou parou de responder): limpa os peers e reconecta. */
  private disconnected(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.ws = null;
    window.clearInterval(this.heartbeatTimer);
    ws.onclose = ws.onmessage = ws.onopen = null;
    try {
      ws.close();
    } catch {}

    const streamer = this.state.watching ? this.peer(this.state.watching) : undefined;
    if (streamer?.key) this.rewatch = { key: streamer.key, until: Date.now() + REWATCH_WINDOW_MS };
    this.closeAllSending();
    this.stopWatchingLocal();

    if (this.left || this.state.status === "full") return;

    this.patch({ status: "reconnecting", self: null, peers: [] });
    const delay = Math.min(10_000, 1000 * 2 ** this.retry++);
    this.retryTimer = window.setTimeout(() => this.open(), delay);
  }

  private send(message: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private sendHello() {
    this.send({
      type: "hello",
      name: this.opts.profile.name,
      color: this.opts.profile.color,
      secret: this.secret,
      install: installId(),
      version: __APP_VERSION__
    });
  }

  updateProfile(profile: Profile) {
    this.opts.profile = profile;
    this.sendHello();
  }

  leave() {
    this.left = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.heartbeatTimer);
    window.clearInterval(this.statsTimer);
    this.stopLive();
    this.stopWatching();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "leave");
    this.patch({ status: "closed" });
  }

  // ---------------------------------------------------------------- signaling

  private async onSignal(msg: Signal) {
    switch (msg.type) {
      case "welcome": {
        this.patch({ status: "connected", self: msg.self, peers: msg.peers });
        // Reconexão no meio de uma transmissão: volta ao ar com a mesma captura.
        if (this.state.localStream) this.send({ type: "go-live" });
        for (const peer of this.state.peers) this.maybeRewatch(peer);
        return;
      }

      case "error": {
        if (msg.code === "room-full") {
          this.patch({ status: "full" });
          this.opts.onEvent({ type: "error", message: "A sala está cheia (máximo de 8 pessoas)." });
          return;
        }
        if (msg.code === "already-live") this.stopLive();
        this.opts.onEvent({ type: "error", message: msg.message });
        return;
      }

      case "peer-joined": {
        this.patch({ peers: [...this.state.peers.filter(p => p.id !== msg.peer.id), msg.peer] });
        this.opts.onEvent({ type: "peer-joined", peer: msg.peer });
        this.maybeRewatch(msg.peer);
        return;
      }

      case "peer-updated": {
        const peer: Peer = msg.peer;
        if (peer.id === this.state.self?.id) {
          this.patch({ self: peer });
          return;
        }
        const previous = this.peer(peer.id);
        this.patch({ peers: this.state.peers.map(p => (p.id === peer.id ? peer : p)) });
        if (previous && !previous.live && peer.live) {
          this.opts.onEvent({ type: "live-started", peer });
          this.maybeRewatch(peer);
        }
        if (previous?.live && !peer.live && this.state.watching === peer.id) this.stopWatchingLocal();
        return;
      }

      case "peer-left": {
        const peer = this.peer(msg.id);
        if (!peer) return;
        if (this.state.watching === peer.id) {
          if (peer.key) this.rewatch = { key: peer.key, until: Date.now() + REWATCH_WINDOW_MS };
          this.stopWatchingLocal();
        }
        this.closeSending(peer.id);
        this.patch({ peers: this.state.peers.filter(p => p.id !== peer.id) });
        this.opts.onEvent({ type: "peer-left", peer });
        return;
      }

      case "watch": {
        const peer = msg.from && this.peer(msg.from);
        if (!peer || !this.state.localStream) return;
        this.opts.onEvent({ type: "viewer-joined", peer });
        await this.startSending(peer.id);
        return;
      }

      case "unwatch":
        if (msg.from) this.closeSending(msg.from);
        return;

      case "offer":
        if (msg.from && isSdp(msg.sdp, "offer")) await this.handleOffer(msg.from, msg.sdp);
        return;

      case "answer": {
        const pc = msg.from && this.sendPcs.get(msg.from);
        if (!pc || !isSdp(msg.sdp, "answer")) return;
        await pc.setRemoteDescription(msg.sdp);
        await this.flushIce(msg.from!, pc);
        return;
      }

      case "ice-candidate":
        if (msg.from && isCandidate(msg.candidate)) await this.addIce(msg.from, msg.candidate);
        return;
    }
  }

  private maybeRewatch(peer: Peer) {
    if (!this.rewatch || !peer.live || this.state.watching) return;
    if (Date.now() > this.rewatch.until) {
      this.rewatch = null;
      return;
    }
    if (peer.key === this.rewatch.key) this.watch(peer.id);
  }

  private createPc(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    pc.onicecandidate = event => {
      if (event.candidate) this.send({ type: "ice-candidate", to: peerId, candidate: event.candidate.toJSON() });
    };
    return pc;
  }

  private async addIce(peerId: string, candidate: RTCIceCandidateInit) {
    const pc = this.recv?.peerId === peerId ? this.recv.pc : this.sendPcs.get(peerId);
    // Só aceita candidatos de quem tem conexão com a gente, e com fila limitada:
    // um peer não consegue encher a memória mandando candidatos falsos.
    if (!pc) return;
    if (!pc.remoteDescription) {
      const queue = this.pendingIce.get(peerId) ?? [];
      if (queue.length < MAX_PENDING_ICE) queue.push(candidate);
      this.pendingIce.set(peerId, queue);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      console.warn("ICE candidate rejeitado", error);
    }
  }

  private async flushIce(peerId: string, pc: RTCPeerConnection) {
    const queue = this.pendingIce.get(peerId) ?? [];
    this.pendingIce.delete(peerId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.warn("ICE candidate rejeitado", error);
      }
    }
  }

  // ---------------------------------------------------------------- transmitir

  private async capture(settings: StreamSettings): Promise<{ stream: MediaStream; systemAudio: SystemAudio | null }> {
    // Som: o capturador nativo tira o Discord (quem assiste já está na call). Se ele
    // falhar, cai no loopback do Chromium, que transmite todo o som do PC.
    let systemAudio: SystemAudio | null = null;
    if (settings.audio) {
      try {
        systemAudio = await startSystemAudio();
      } catch (error) {
        console.warn("Capturador de áudio indisponível, usando loopback", error);
        this.opts.onEvent({
          type: "error",
          message: "Não deu para separar o som do Discord; transmitindo todo o som do PC."
        });
      }
    }
    const loopback = settings.audio && !systemAudio;

    try {
      await window.janshare.selectSource(settings.sourceId, loopback);
      const { width, height } = RESOLUTIONS[settings.resolution];
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          ...(width ? { width: { max: width }, height: { max: height } } : {}),
          frameRate: { ideal: settings.fps, max: settings.fps }
        },
        audio: loopback
      });
      if (systemAudio) stream.addTrack(systemAudio.track);

      const video = stream.getVideoTracks()[0];
      // "motion" prioriza fluidez (jogos/vídeo); "detail" prioriza nitidez (texto/código).
      video.contentHint = settings.fps >= 60 ? "motion" : "detail";
      video.addEventListener("ended", () => {
        if (this.state.localStream === stream) this.stopLive();
      });
      return { stream, systemAudio };
    } catch (error) {
      systemAudio?.stop();
      throw error;
    }
  }

  /** Começa a transmitir ou, se já estiver ao vivo, troca a fonte sem derrubar ninguém. */
  async goLive(settings: StreamSettings) {
    const { stream, systemAudio } = await this.capture(settings);
    const previous = this.state.localStream;
    const previousAudio = this.systemAudio;
    this.systemAudio = systemAudio;

    if (previous) {
      const video = stream.getVideoTracks()[0] ?? null;
      const audio = stream.getAudioTracks()[0] ?? null;
      for (const pc of this.sendPcs.values()) {
        const [videoTx, audioTx] = pc.getTransceivers();
        await videoTx?.sender.replaceTrack(video);
        await audioTx?.sender.replaceTrack(audio);
        await this.applyBitrate(videoTx?.sender, settings);
      }
      previous.getTracks().forEach(track => track.stop());
      previousAudio?.stop();
      this.patch({ localStream: stream, streamSettings: settings });
      return;
    }

    this.patch({ localStream: stream, streamSettings: settings });
    this.send({ type: "go-live" });
  }

  stopLive() {
    const stream = this.state.localStream;
    if (!stream) return;
    stream.getTracks().forEach(track => track.stop());
    this.systemAudio?.stop();
    this.systemAudio = null;
    this.closeAllSending();
    this.patch({ localStream: null, streamSettings: null, streamerStats: null });
    this.send({ type: "stop-live" });
  }

  private async applyBitrate(sender: RTCRtpSender | undefined, settings: StreamSettings) {
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings[0].maxBitrate = bitrateFor(settings);
    params.encodings[0].maxFramerate = settings.fps;
    try {
      await sender.setParameters(params);
    } catch (error) {
      console.warn("setParameters falhou", error);
    }
  }

  private async startSending(viewerId: string) {
    const stream = this.state.localStream;
    const settings = this.state.streamSettings;
    if (!stream || !settings) return;

    this.closeSending(viewerId);
    const pc = this.createPc(viewerId);
    this.sendPcs.set(viewerId, pc);

    // Transceivers fixos (vídeo, áudio) para poder trocar a fonte ou ligar o
    // áudio depois só com replaceTrack, sem renegociar.
    pc.addTransceiver(stream.getVideoTracks()[0] ?? "video", {
      direction: "sendonly",
      streams: [stream],
      sendEncodings: [{ maxBitrate: bitrateFor(settings), maxFramerate: settings.fps }]
    });
    pc.addTransceiver(stream.getAudioTracks()[0] ?? "audio", { direction: "sendonly", streams: [stream] });

    pc.onconnectionstatechange = () => {
      if (this.sendPcs.get(viewerId) !== pc) return;
      if (pc.connectionState === "failed") void this.restartIce(viewerId, pc);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: "offer", to: viewerId, sdp: pc.localDescription });
  }

  private async restartIce(viewerId: string, pc: RTCPeerConnection) {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    this.send({ type: "offer", to: viewerId, sdp: pc.localDescription });
  }

  private closeSending(viewerId: string) {
    const pc = this.sendPcs.get(viewerId);
    if (!pc) return;
    this.sendPcs.delete(viewerId);
    this.pendingIce.delete(viewerId);
    for (const key of this.lastBytes.keys()) {
      if (key.startsWith(`${viewerId}:`)) this.lastBytes.delete(key);
    }
    pc.close();
  }

  private closeAllSending() {
    for (const id of [...this.sendPcs.keys()]) this.closeSending(id);
  }

  // ---------------------------------------------------------------- assistir

  watch(streamerId: string) {
    if (this.state.watching) this.stopWatching();
    this.rewatch = null;
    this.patch({ watching: streamerId, remoteStream: null, remoteState: "waiting", viewerStats: null });
    this.send({ type: "watch", to: streamerId });
  }

  stopWatching() {
    const id = this.state.watching;
    if (!id) return;
    this.rewatch = null;
    this.send({ type: "unwatch", to: id });
    this.stopWatchingLocal();
  }

  private stopWatchingLocal() {
    if (this.recv) {
      this.pendingIce.delete(this.recv.peerId);
      this.lastBytes.delete(this.recv.peerId);
      this.recv.pc.close();
      this.recv = null;
    }
    if (this.state.watching) {
      this.patch({ watching: null, remoteStream: null, remoteState: "waiting", viewerStats: null });
    }
  }

  private async handleOffer(from: string, sdp: RTCSessionDescriptionInit) {
    if (this.state.watching !== from) return;

    // Mesma conexão = ICE restart; reaproveita.
    let pc = this.recv?.peerId === from ? this.recv.pc : null;
    if (!pc) {
      const created = this.createPc(from);
      this.recv = { peerId: from, pc: created };
      created.ontrack = event => {
        const tracks = this.state.remoteStream?.getTracks() ?? [];
        this.patch({ remoteStream: new MediaStream([...tracks.filter(t => t !== event.track), event.track]) });
      };
      created.onconnectionstatechange = () => {
        if (this.recv?.pc === created) this.patch({ remoteState: created.connectionState });
      };
      pc = created;
    }

    await pc.setRemoteDescription(sdp);
    await this.flushIce(from, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send({ type: "answer", to: from, sdp: pc.localDescription });
  }

  // ---------------------------------------------------------------- estatísticas

  private kbps(key: string, bytes: number, time: number): number {
    const last = this.lastBytes.get(key);
    this.lastBytes.set(key, { bytes, time });
    if (!last || time <= last.time) return 0;
    return Math.max(0, Math.round(((bytes - last.bytes) * 8) / (time - last.time)));
  }

  private async route(pc: RTCPeerConnection, report?: RTCStatsReport): Promise<{ route: Route; rttMs: number | null }> {
    const stats = report ?? (await pc.getStats());
    let pair: any;
    stats.forEach(s => {
      if (s.type === "transport" && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
    });
    if (!pair) {
      stats.forEach(s => {
        if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") pair = s;
      });
    }
    if (!pair) return { route: "unknown", rttMs: null };
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    const relay = local?.candidateType === "relay" || remote?.candidateType === "relay";
    return {
      route: relay ? "relay" : "direct",
      rttMs: typeof pair.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : null
    };
  }

  private async collectStats() {
    if (this.recv) {
      const { pc, peerId } = this.recv;
      const report = await pc.getStats();
      let inbound: any;
      report.forEach(s => {
        if (s.type === "inbound-rtp" && s.kind === "video") inbound = s;
      });
      if (inbound && this.recv?.pc === pc) {
        const { route, rttMs } = await this.route(pc, report);
        this.patch({
          viewerStats: {
            kbps: this.kbps(peerId, inbound.bytesReceived ?? 0, inbound.timestamp),
            fps: Math.round(inbound.framesPerSecond ?? 0),
            width: inbound.frameWidth ?? 0,
            height: inbound.frameHeight ?? 0,
            rttMs,
            route
          }
        });
      }
    }

    if (this.state.localStream) {
      let total = 0;
      const viewers: StreamerStats["viewers"] = [];
      for (const [id, pc] of this.sendPcs) {
        if (pc.connectionState !== "connected") continue;
        const report = await pc.getStats();
        report.forEach(s => {
          if (s.type === "outbound-rtp") total += this.kbps(`${id}:${s.id}`, s.bytesSent ?? 0, s.timestamp);
        });
        viewers.push({ id, route: (await this.route(pc, report)).route });
      }
      if (this.state.localStream) this.patch({ streamerStats: { kbps: total, viewers } });
    }
  }
}
