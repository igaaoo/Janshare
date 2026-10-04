import { useCallback, useState } from "react";

export const DEFAULT_SERVER = "https://webrtc-screen-share-mvp.scshare.workers.dev";

export const AVATAR_COLORS = ["#5865f2", "#3ba55c", "#faa61a", "#ed4245", "#eb459e", "#00a8fc", "#9b84ee", "#747f8d"];

export type Profile = { name: string; color: string };
export type RecentRoom = { id: string; joinedAt: number };

export type Settings = {
  profile: Profile;
  server: string;
  recentRooms: RecentRoom[];
};

const KEY = "janshare.settings";

function load(): Settings {
  const fallback: Settings = {
    profile: { name: "", color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] },
    server: DEFAULT_SERVER,
    recentRooms: []
  };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
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
