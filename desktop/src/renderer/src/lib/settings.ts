import { useCallback, useState } from "react";
import { detectLanguage, type Language } from "./i18n";

export const DEFAULT_SERVER = "https://janshare.igaaoo.workers.dev";

// Endereços antigos do servidor padrão: quem tem um deles salvo passa para o novo.
const LEGACY_SERVERS = ["https://webrtc-screen-share-mvp.scshare.workers.dev"];

export const AVATAR_COLORS = ["#5865f2", "#3ba55c", "#faa61a", "#ed4245", "#eb459e", "#00a8fc", "#9b84ee", "#747f8d"];

export type Profile = { name: string; color: string };
export type RecentRoom = { id: string; joinedAt: number };

export type Settings = {
  profile: Profile;
  server: string;
  recentRooms: RecentRoom[];
  language: Language;
};

const KEY = "janshare.settings";

function load(): Settings {
  const fallback: Settings = {
    profile: { name: "", color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] },
    server: DEFAULT_SERVER,
    recentRooms: [],
    language: detectLanguage()
  };
  try {
    const settings: Settings = { ...fallback, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    if (LEGACY_SERVERS.includes(settings.server.replace(/\/+$/, ""))) settings.server = DEFAULT_SERVER;
    if (settings.language !== "en" && settings.language !== "pt") settings.language = fallback.language;
    return settings;
  } catch {
    return fallback;
  }
}

export function useSettings(): [Settings, (update: (s: Settings) => Settings) => void] {
  const [settings, setSettings] = useState(load);

  const update = useCallback((fn: (s: Settings) => Settings) => {
    setSettings(current => {
      const next = fn(current);
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return [settings, update];
}

export function rememberRoom(settings: Settings, id: string): Settings {
  const rest = settings.recentRooms.filter(room => room.id !== id);
  return { ...settings, recentRooms: [{ id, joinedAt: Date.now() }, ...rest].slice(0, 12) };
}

export function forgetRoom(settings: Settings, id: string): Settings {
  return { ...settings, recentRooms: settings.recentRooms.filter(room => room.id !== id) };
}
