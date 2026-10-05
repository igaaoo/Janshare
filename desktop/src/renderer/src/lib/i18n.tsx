import { createContext, useContext, useMemo, type ReactNode } from "react";

export type Language = "en" | "pt";

export const LANGUAGES: Array<{ value: Language; label: string }> = [
  { value: "en", label: "English" },
  { value: "pt", label: "Português" }
];

// Fonte de verdade das chaves; o dicionário em português precisa ter todas.
const en = {
  // Salas e notificações
  "toast.peerJoined": "{name} joined the room",
  "toast.peerLeft": "{name} left the room",
  "toast.liveStarted": "{name} started streaming",
  "toast.viewerJoined": "{name} is watching your stream",
  "toast.inviteCopied": "Invite link copied!",
  "toast.roomCreated": "Room created! Invite link copied.",
  "toast.serverChanged": "Server changed. Rejoin the room to use the new server.",
  "notify.liveTitle": "Live now",
  "error.roomFull": "The room is full (max 8 people).",
  "error.alreadyLive": "{name} is already streaming.",
  "error.audioFallback": "Couldn't leave out Discord's audio; streaming all computer sound.",
  "error.sourceNotFound": "Source not found. Refresh the list and try again.",

  // Barra de salas e barra lateral
  "rail.label": "Rooms",
  "rail.home": "Home",
  "rail.create": "Create room",
  "room.name": "Room {id}",
  "sidebar.invite": "Invite people",
  "sidebar.recent": "Recent rooms",
  "sidebar.category": "Stream channels",
  "sidebar.empty": "No rooms yet. Create one or paste an invite.",
  "sidebar.removeRecent": "Remove from recents",
  "channel.name": "Stream",
  "live.badge": "LIVE",
  "watch.button": "Watch stream",

  // Painel de conexão e usuário
  "status.streaming": "Streaming",
  "status.connected": "Connected",
  "status.full": "Room full",
  "status.reconnecting": "Reconnecting…",
  "status.connecting": "Connecting…",
  "action.shareScreen": "Share screen",
  "action.shareYourScreen": "Share your screen",
  "action.stopStreaming": "Stop streaming",
  "action.disconnect": "Disconnect",
  "action.leaveRoom": "Leave room",
  "action.copyInvite": "Copy invite",
  "user.noName": "No name",
  "user.live": "Live",
  "user.online": "Online",
  "settings.title": "Settings",

  // Cabeçalho e início
  "header.inRoom": "{count} in the room",
  "header.watching": "{count} watching",
  "header.viaTurn": "via TURN",
  "header.invite": "Invite",
  "home.title": "Share your screen with friends",
  "home.text": "Create a room, send the link and go live. Video goes straight from one computer to the other.",
  "home.join.title": "Join a room",
  "home.join.text": "Paste the invite link or the room code.",
  "home.join.button": "Join",
  "home.join.invalid": "Invalid link or code.",

  // Atualização
  "update.ready": "Update {version} ready.",
  "update.onQuit": "It will be installed when you close the app.",
  "update.restartHint": "Restart to install.",
  "update.restart": "Restart",
  "update.later": "Later",

  // Palco
  "stage.yourStream": "Your stream",
  "stage.viewers": "Viewers",
  "stage.you": "(you)",
  "stage.full.title": "The room is full",
  "stage.full.text": "This room already has the maximum number of people.",
  "stage.reconnecting": "Connection lost. Reconnecting…",
  "stage.connecting": "Connecting to the room…",
  "stage.alone": "No one here yet",

  // Player
  "player.connecting": "Connecting to the stream…",
  "player.unstable": "Unstable connection, reconnecting…",
  "player.failed": "Couldn't connect. Trying again…",
  "player.stats": "Statistics",
  "player.resolution": "Resolution",
  "player.fps": "FPS",
  "player.bitrate": "Bitrate",
  "player.latency": "Latency",
  "player.connection": "Connection",
  "player.direct": "Direct P2P",
  "player.relay": "Via TURN",
  "player.unmute": "Unmute",
  "player.mute": "Mute",
  "player.noAudio": "Stream has no audio",
  "player.volume": "Stream volume",
  "player.pin": "Keep window on top",
  "player.fullscreen": "Fullscreen",
  "player.exitFullscreen": "Exit fullscreen",
  "player.stop": "Stop watching",

  // Configurações
  "settings.welcome": "Welcome!",
  "settings.welcomeText": "How do you want to appear to others in the room?",
  "settings.close": "Close",
  "settings.name": "Display name",
  "settings.namePlaceholder": "Your name",
  "settings.color": "Avatar color",
  "settings.colorOption": "Color {value}",
  "settings.language": "Language",
  "settings.server": "Signaling server",
  "settings.restoreServer": "Restore default",
  "settings.shortcuts": "Shortcuts",
  "settings.shortcutGoLive": "start / stop streaming",
  "settings.cancel": "Cancel",
  "settings.continue": "Continue",
  "settings.save": "Save",

  // Modal de transmissão
  "golive.title": "Screen share",
  "golive.titleSwitch": "Switch stream",
  "golive.close": "Close",
  "golive.tabApps": "Applications",
  "golive.tabScreens": "Screens",
  "golive.refresh": "Refresh list",
  "golive.loading": "Loading sources…",
  "golive.emptyWindows": "No open windows found.",
  "golive.emptyScreens": "No screens found.",
  "golive.resolution": "Resolution",
  "golive.resolutionSource": "Source",
  "golive.frameRate": "Frame rate",
  "golive.audio": "Share system audio",
  "golive.audioHint": "Streams your computer's sound, except Discord's.",
  "golive.estimate": "Estimated upload: ~{mbps} Mbps",
  "golive.estimateViewers": "({count} viewers)",
  "golive.cancel": "Cancel",
  "golive.starting": "Starting…",
  "golive.switch": "Switch",
  "golive.goLive": "Go live"
};

export type MessageKey = keyof typeof en;

const pt: Record<MessageKey, string> = {
  "toast.peerJoined": "{name} entrou na sala",
  "toast.peerLeft": "{name} saiu da sala",
  "toast.liveStarted": "{name} começou a transmitir",
  "toast.viewerJoined": "{name} está assistindo sua transmissão",
  "toast.inviteCopied": "Link de convite copiado!",
  "toast.roomCreated": "Sala criada! Link de convite copiado.",
  "toast.serverChanged": "Servidor alterado. Entre na sala de novo para usar o novo servidor.",
  "notify.liveTitle": "Transmissão ao vivo",
  "error.roomFull": "A sala está cheia (máximo de 8 pessoas).",
  "error.alreadyLive": "{name} já está transmitindo.",
  "error.audioFallback": "Não deu para separar o som do Discord; transmitindo todo o som do PC.",
  "error.sourceNotFound": "Fonte não encontrada. Atualize a lista e tente de novo.",

  "rail.label": "Salas",
  "rail.home": "Início",
  "rail.create": "Criar sala",
  "room.name": "Sala {id}",
  "sidebar.invite": "Convidar pessoas",
  "sidebar.recent": "Salas recentes",
  "sidebar.category": "Canais de transmissão",
  "sidebar.empty": "Nenhuma sala ainda. Crie uma ou cole um convite.",
  "sidebar.removeRecent": "Remover dos recentes",
  "channel.name": "Transmissão",
  "live.badge": "AO VIVO",
  "watch.button": "Assistir transmissão",

  "status.streaming": "Transmitindo",
  "status.connected": "Conectado",
  "status.full": "Sala cheia",
  "status.reconnecting": "Reconectando…",
  "status.connecting": "Conectando…",
  "action.shareScreen": "Compartilhar tela",
  "action.shareYourScreen": "Compartilhar sua tela",
  "action.stopStreaming": "Parar transmissão",
  "action.disconnect": "Desconectar",
  "action.leaveRoom": "Sair da sala",
  "action.copyInvite": "Copiar convite",
  "user.noName": "Sem nome",
  "user.live": "Ao vivo",
  "user.online": "Online",
  "settings.title": "Configurações",

  "header.inRoom": "{count} na sala",
  "header.watching": "{count} assistindo",
  "header.viaTurn": "via TURN",
  "header.invite": "Convidar",
  "home.title": "Compartilhe sua tela com os amigos",
  "home.text": "Crie uma sala, mande o link e transmita. O vídeo vai direto de um computador para o outro.",
  "home.join.title": "Entrar em uma sala",
  "home.join.text": "Cole o link de convite ou o código da sala.",
  "home.join.button": "Entrar",
  "home.join.invalid": "Link ou código inválido.",

  "update.ready": "Atualização {version} pronta.",
  "update.onQuit": "Ela será instalada quando você fechar o app.",
  "update.restartHint": "Reinicie para instalar.",
  "update.restart": "Reiniciar",
  "update.later": "Depois",

  "stage.yourStream": "Sua transmissão",
  "stage.viewers": "Espectadores",
  "stage.you": "(você)",
  "stage.full.title": "A sala está cheia",
  "stage.full.text": "Esta sala já tem o número máximo de pessoas.",
  "stage.reconnecting": "Conexão perdida. Reconectando…",
  "stage.connecting": "Conectando à sala…",
  "stage.alone": "Ninguém por aqui ainda",

  "player.connecting": "Conectando à transmissão…",
  "player.unstable": "Conexão instável, reconectando…",
  "player.failed": "Não foi possível conectar. Tentando de novo…",
  "player.stats": "Estatísticas",
  "player.resolution": "Resolução",
  "player.fps": "FPS",
  "player.bitrate": "Bitrate",
  "player.latency": "Latência",
  "player.connection": "Conexão",
  "player.direct": "P2P direto",
  "player.relay": "Via TURN",
  "player.unmute": "Ativar som",
  "player.mute": "Silenciar",
  "player.noAudio": "Transmissão sem áudio",
  "player.volume": "Volume da transmissão",
  "player.pin": "Manter janela no topo",
  "player.fullscreen": "Tela cheia",
  "player.exitFullscreen": "Sair da tela cheia",
  "player.stop": "Parar de assistir",

  "settings.welcome": "Boas-vindas!",
  "settings.welcomeText": "Como você quer aparecer para quem estiver na sala?",
  "settings.close": "Fechar",
  "settings.name": "Nome de exibição",
  "settings.namePlaceholder": "Seu nome",
  "settings.color": "Cor do avatar",
  "settings.colorOption": "Cor {value}",
  "settings.language": "Idioma",
  "settings.server": "Servidor de signaling",
  "settings.restoreServer": "Restaurar padrão",
  "settings.shortcuts": "Atalhos",
  "settings.shortcutGoLive": "iniciar / parar transmissão",
  "settings.cancel": "Cancelar",
  "settings.continue": "Continuar",
  "settings.save": "Salvar",

  "golive.title": "Compartilhamento de tela",
  "golive.titleSwitch": "Trocar transmissão",
  "golive.close": "Fechar",
  "golive.tabApps": "Aplicativos",
  "golive.tabScreens": "Telas",
  "golive.refresh": "Atualizar lista",
  "golive.loading": "Carregando fontes…",
  "golive.emptyWindows": "Nenhuma janela aberta encontrada.",
  "golive.emptyScreens": "Nenhuma tela encontrada.",
  "golive.resolution": "Resolução",
  "golive.resolutionSource": "Fonte",
  "golive.frameRate": "Taxa de quadros",
  "golive.audio": "Compartilhar áudio do sistema",
  "golive.audioHint": "Transmite o som do computador, exceto o do Discord.",
  "golive.estimate": "Upload estimado: ~{mbps} Mbps",
  "golive.estimateViewers": "({count} espectadores)",
  "golive.cancel": "Cancelar",
  "golive.starting": "Iniciando…",
  "golive.switch": "Trocar",
  "golive.goLive": "Ao vivo"
};

const dictionaries: Record<Language, Record<MessageKey, string>> = { en, pt };

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function translate(language: Language, key: MessageKey, params?: Record<string, string | number>): string {
  const text = dictionaries[language][key] ?? en[key];
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text;
}

/** Idioma do sistema: português para pt-*, inglês para o resto. */
export function detectLanguage(): Language {
  return navigator.language.toLowerCase().startsWith("pt") ? "pt" : "en";
}

const I18nContext = createContext<{ language: Language; t: Translate }>({
  language: "en",
  t: (key, params) => translate("en", key, params)
});

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const value = useMemo(() => ({ language, t: ((key, params) => translate(language, key, params)) as Translate }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
