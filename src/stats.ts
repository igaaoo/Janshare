import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

/**
 * Estatísticas de uso, anônimas: uma única instância ("global") com SQLite.
 * As salas chamam os métodos RPC nos eventos (entrar, sair, transmitir, assistir).
 * Tudo é contador incremental, então ler o resumo não varre tabelas grandes.
 *
 * Nada pessoal é guardado: o id de instalação chega como hash (keyFor no Room),
 * a sala é o id do Durable Object (não reversível para o código) e o país é o
 * código de 2 letras que a Cloudflare informa. Nomes e IPs nunca chegam aqui.
 */

type DayCounter =
  | "users"
  | "new_users"
  | "sessions"
  | "session_seconds"
  | "rooms"
  | "streams"
  | "stream_seconds"
  | "watches"
  | "watch_seconds";

type TotalCounter = "users" | "sessions" | "session_seconds" | "rooms" | "streams" | "stream_seconds" | "watches" | "watch_seconds";

export type StatsDay = {
  day: string;
  users: number;
  newUsers: number;
  sessions: number;
  rooms: number;
  streams: number;
  streamHours: number;
  watchHours: number;
  peak: number;
};

export type StatsSummary = {
  updatedAt: string;
  online: number;
  totals: {
    users: number;
    sessions: number;
    rooms: number;
    streams: number;
    sessionHours: number;
    streamHours: number;
    watchHours: number;
    peakOnline: number;
  };
  active: { today: number; last7: number; last30: number };
  countries: Array<{ country: string; users: number }>;
  versions: Array<{ version: string; users: number }>;
  days: StatsDay[];
};

const CACHE_MS = 5 * 60_000;
// Sala sem notícia há mais que isso não entra no "online agora" (o DO pode ter
// sido reiniciado sem avisar a saída, por exemplo num deploy).
const ONLINE_STALE_MS = 12 * 3600_000;
const MAX_SECONDS = 24 * 3600;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

function clampSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_SECONDS, Math.round(value))) : 0;
}

const hours = (seconds: number) => Math.round((seconds / 3600) * 10) / 10;

export class Stats extends DurableObject<Env> {
  private cache: { at: number; data: Omit<StatsSummary, "online"> } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS installs (
        id TEXT PRIMARY KEY, first_day TEXT NOT NULL, last_day TEXT NOT NULL, country TEXT, version TEXT
      );
      CREATE INDEX IF NOT EXISTS installs_last_day ON installs (last_day);
      CREATE TABLE IF NOT EXISTS daily (
        day TEXT PRIMARY KEY,
        users INTEGER NOT NULL DEFAULT 0, new_users INTEGER NOT NULL DEFAULT 0,
        sessions INTEGER NOT NULL DEFAULT 0, session_seconds INTEGER NOT NULL DEFAULT 0,
        rooms INTEGER NOT NULL DEFAULT 0,
        streams INTEGER NOT NULL DEFAULT 0, stream_seconds INTEGER NOT NULL DEFAULT 0,
        watches INTEGER NOT NULL DEFAULT 0, watch_seconds INTEGER NOT NULL DEFAULT 0,
        peak INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS totals (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS online (room TEXT PRIMARY KEY, count INTEGER NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS countries (country TEXT PRIMARY KEY, users INTEGER NOT NULL DEFAULT 0);
    `);
  }

  private get sql() {
    return this.ctx.storage.sql;
  }

  // Colunas vêm de tipos fixos (DayCounter/TotalCounter), nunca de entrada externa.
  private bumpDay(column: DayCounter, amount = 1) {
    this.sql.exec(
      `INSERT INTO daily (day, ${column}) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET ${column} = ${column} + excluded.${column}`,
      today(),
      amount
    );
  }

  private bumpTotal(key: TotalCounter, amount = 1) {
    this.sql.exec(
      "INSERT INTO totals (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = value + excluded.value",
      key,
      amount
    );
  }

  private bump(counter: DayCounter & TotalCounter, amount = 1) {
    if (amount <= 0) return;
    this.bumpDay(counter, amount);
    this.bumpTotal(counter, amount);
  }

  private onlineNow(): number {
    const row = this.sql
      .exec<{ total: number }>("SELECT COALESCE(SUM(count), 0) AS total FROM online WHERE at > ?", Date.now() - ONLINE_STALE_MS)
      .one();
    return row.total;
  }

  private setRoomOnline(room: string, count: number) {
    if (count > 0) {
      this.sql.exec(
        "INSERT INTO online (room, count, at) VALUES (?, ?, ?) ON CONFLICT (room) DO UPDATE SET count = excluded.count, at = excluded.at",
        room,
        count,
        Date.now()
      );
    } else {
      this.sql.exec("DELETE FROM online WHERE room = ?", room);
    }
    this.sql.exec("DELETE FROM online WHERE at <= ?", Date.now() - ONLINE_STALE_MS);

    const online = this.onlineNow();
    this.sql.exec(
      "INSERT INTO daily (day, peak) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET peak = MAX(peak, excluded.peak)",
      today(),
      online
    );
    this.sql.exec(
      "INSERT INTO totals (key, value) VALUES ('peak', ?) ON CONFLICT (key) DO UPDATE SET value = MAX(value, excluded.value)",
      online
    );
  }

  // ------------------------------------------------------------------ eventos (RPC)

  async join(event: { install: string; version: string; country: string; room: string; online: number }) {
    const day = today();
    const country = /^[A-Z]{2}$/.test(event.country) ? event.country : "XX";
    const version = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(event.version) ? event.version : "";

    this.bump("sessions");
    if (this.sql.exec("INSERT OR IGNORE INTO rooms (id) VALUES (?)", event.room).rowsWritten > 0) this.bump("rooms");

    if (event.install) {
      const existing = this.sql
        .exec<{ last_day: string }>("SELECT last_day FROM installs WHERE id = ?", event.install)
        .toArray()[0];
      if (!existing) {
        this.sql.exec(
          "INSERT INTO installs (id, first_day, last_day, country, version) VALUES (?, ?, ?, ?, ?)",
          event.install,
          day,
          day,
          country,
          version
        );
        this.sql.exec(
          "INSERT INTO countries (country, users) VALUES (?, 1) ON CONFLICT (country) DO UPDATE SET users = users + 1",
          country
        );
        this.bumpDay("new_users");
        this.bumpDay("users");
        this.bumpTotal("users");
      } else {
        if (existing.last_day !== day) this.bumpDay("users");
        this.sql.exec("UPDATE installs SET last_day = ?, version = ? WHERE id = ?", day, version, event.install);
      }
    }

    this.setRoomOnline(event.room, event.online);
  }

  async leave(event: { room: string; online: number; seconds: number }) {
    this.bump("session_seconds", clampSeconds(event.seconds));
    this.setRoomOnline(event.room, event.online);
  }

  async streamStarted() {
    this.bump("streams");
  }

  async streamEnded(seconds: number) {
    this.bump("stream_seconds", clampSeconds(seconds));
  }

  async watchStarted() {
    this.bump("watches");
  }

  async watchEnded(seconds: number) {
    this.bump("watch_seconds", clampSeconds(seconds));
  }

  // ------------------------------------------------------------------ leitura

  async summary(): Promise<StatsSummary> {
    if (!this.cache || Date.now() - this.cache.at > CACHE_MS) {
      this.cache = { at: Date.now(), data: this.compute() };
    }
    return { ...this.cache.data, online: this.onlineNow() };
  }

  private compute(): Omit<StatsSummary, "online"> {
    const totals = Object.fromEntries(
      this.sql.exec<{ key: string; value: number }>("SELECT key, value FROM totals").toArray().map(r => [r.key, r.value])
    ) as Record<string, number | undefined>;
    const total = (key: string) => totals[key] ?? 0;

    // Usam o índice em last_day: só leem as linhas que entram na conta.
    const activeSince = (day: string) =>
      this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM installs WHERE last_day >= ?", day).one().n;

    const days = this.sql
      .exec<{
        day: string;
        users: number;
        new_users: number;
        sessions: number;
        rooms: number;
        streams: number;
        stream_seconds: number;
        watch_seconds: number;
        peak: number;
      }>("SELECT * FROM daily ORDER BY day")
      .toArray()
      .map(d => ({
        day: d.day,
        users: d.users,
        newUsers: d.new_users,
        sessions: d.sessions,
        rooms: d.rooms,
        streams: d.streams,
        streamHours: hours(d.stream_seconds),
        watchHours: hours(d.watch_seconds),
        peak: d.peak
      }));

    return {
      updatedAt: new Date().toISOString(),
      totals: {
        users: total("users"),
        sessions: total("sessions"),
        rooms: total("rooms"),
        streams: total("streams"),
        sessionHours: hours(total("session_seconds")),
        streamHours: hours(total("stream_seconds")),
        watchHours: hours(total("watch_seconds")),
        peakOnline: total("peak")
      },
      active: { today: activeSince(today()), last7: activeSince(daysAgo(6)), last30: activeSince(daysAgo(29)) },
      countries: this.sql
        .exec<{ country: string; users: number }>("SELECT country, users FROM countries ORDER BY users DESC LIMIT 10")
        .toArray(),
      versions: this.sql
        .exec<{ version: string; users: number }>(
          "SELECT version, COUNT(*) AS users FROM installs WHERE last_day >= ? AND version != '' GROUP BY version ORDER BY users DESC LIMIT 5",
          daysAgo(29)
        )
        .toArray(),
      days
    };
  }
}
