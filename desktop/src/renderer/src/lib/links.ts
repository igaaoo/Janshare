const ROOM_ID = /^[a-zA-Z0-9_-]{6,64}$/;

export function makeRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function inviteUrl(server: string, roomId: string): string {
  return `${server.replace(/\/+$/, "")}/room/${roomId}`;
}

/** Aceita o link https, o link janshare:// (ou o antigo scshare://) ou só o código da sala. */
export function parseRoomInput(input: string): string | null {
  const value = input.trim();
  if (ROOM_ID.test(value)) return value;
  const match = value.match(/\/room\/([a-zA-Z0-9_-]+)\/?(?:[?#].*)?$/);
  return match && ROOM_ID.test(match[1]) ? match[1] : null;
}

export function roomInitials(roomId: string): string {
  return roomId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase();
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[1][0]).toUpperCase();
}
