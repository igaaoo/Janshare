import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "./components/Avatar";
import { GoLiveModal } from "./components/GoLiveModal";
import {
  CloseIcon,
  GearIcon,
  HangupIcon,
  LogoIcon,
  PersonAddIcon,
  PlusIcon,
  ScreenShareIcon,
  SignalIcon,
  SpeakerIcon,
  StopShareIcon,
  UsersIcon
} from "./components/Icons";
import { SettingsModal } from "./components/SettingsModal";
import { Stage } from "./components/Stage";
import { I18nProvider, translate, type Translate } from "./lib/i18n";
import { inviteUrl, makeRoomId, parseRoomInput, roomInitials } from "./lib/links";
import { RoomClient, type RoomEvent, type RoomSnapshot, type StreamSettings } from "./lib/room";
import { forgetRoom, rememberRoom, useSettings } from "./lib/settings";

type Toast = { id: number; text: string; kind: "info" | "error" | "success" };

export function App() {
  const [settings, updateSettings] = useSettings();
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const client = useRef<RoomClient | null>(null);
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const language = settings.language;
  const t: Translate = (key, params) => translate(language, key, params);
  // Os eventos da sala chegam por callbacks criados ao entrar; o ref garante o idioma atual.
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    document.documentElement.lang = language === "pt" ? "pt-BR" : "en";
  }, [language]);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts(list => [...list.slice(-3), { id, text, kind }]);
    window.setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), 4000);
  }, []);

  const onRoomEvent = useCallback(
    (event: RoomEvent) => {
      const t = tRef.current;
      switch (event.type) {
        case "peer-joined":
          toast(t("toast.peerJoined", { name: event.peer.name }));
          void window.janshare.notify("Janshare", t("toast.peerJoined", { name: event.peer.name }));
          break;
        case "peer-left":
          toast(t("toast.peerLeft", { name: event.peer.name }));
          break;
        case "live-started":
          toast(t("toast.liveStarted", { name: event.peer.name }), "success");
          void window.janshare.notify(t("notify.liveTitle"), t("toast.liveStarted", { name: event.peer.name }));
          break;
        case "viewer-joined":
          toast(t("toast.viewerJoined", { name: event.peer.name }));
          break;
        case "error":
          if (event.code === "room-full") toast(t("error.roomFull"), "error");
          else if (event.code === "already-live") toast(t("error.alreadyLive", { name: event.name ?? "?" }), "error");
          else if (event.code === "audio-fallback") toast(t("error.audioFallback"), "error");
          else if (event.message) toast(event.message, "error");
          break;
      }
    },
    [toast]
  );

  const leaveRoom = useCallback(() => {
    client.current?.leave();
    client.current = null;
    setRoom(null);
    setGoLiveOpen(false);
  }, []);

  const joinRoom = useCallback(
    (roomId: string) => {
      if (client.current?.snapshot.roomId === roomId && client.current.snapshot.status !== "full") return;
      client.current?.leave();

      const current = settingsRef.current;
      const next = new RoomClient({
        server: current.server,
        roomId,
        profile: current.profile,
        onChange: snapshot => {
          if (client.current === next) setRoom(snapshot);
        },
        onEvent: event => {
          if (client.current === next) onRoomEvent(event);
        }
      });
      client.current = next;
      setRoom(next.snapshot);
      updateSettings(s => rememberRoom(s, roomId));
      void next.start();
    },
    [onRoomEvent, updateSettings]
  );

  const copyInvite = useCallback(async () => {
    if (!room) return;
    await navigator.clipboard.writeText(inviteUrl(settingsRef.current.server, room.roomId));
    toast(tRef.current("toast.inviteCopied"), "success");
  }, [room, toast]);

  // Links janshare:// (abertos pelo navegador ou na inicialização).
  useEffect(() => {
    const open = (url: string) => {
      const id = parseRoomInput(url);
      if (id) joinRoom(id);
    };
    void window.janshare.consumeDeepLink().then(url => url && open(url));
    return window.janshare.onDeepLink(open);
  }, [joinRoom]);

  // Atualização baixada em segundo plano (main/index.ts → setupUpdates).
  useEffect(() => {
    void window.janshare.pendingUpdate().then(version => version && setUpdateVersion(version));
    return window.janshare.onUpdateReady(setUpdateVersion);
  }, []);

  // Atalho global: inicia (abre o seletor) ou para a transmissão.
  useEffect(
    () =>
      window.janshare.onGoLiveShortcut(() => {
        const snapshot = client.current?.snapshot;
        if (!snapshot || snapshot.status !== "connected") return;
        if (snapshot.localStream) client.current?.stopLive();
        else setGoLiveOpen(true);
      }),
    []
  );

  useEffect(() => {
    const onUnload = () => client.current?.leave();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const createRoom = () => {
    const id = makeRoomId();
    joinRoom(id);
    void navigator.clipboard.writeText(inviteUrl(settings.server, id)).then(() => toast(t("toast.roomCreated"), "success"));
  };

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    const id = parseRoomInput(joinInput);
    if (!id) {
      setJoinError(t("home.join.invalid"));
      return;
    }
    setJoinError(null);
    setJoinInput("");
    joinRoom(id);
  };

  const startLive = async (streamSettings: StreamSettings) => {
    await client.current?.goLive(streamSettings);
    setGoLiveOpen(false);
  };

  const live = Boolean(room?.localStream);
  const onboarding = !settings.profile.name;

  return (
    <I18nProvider language={language}>
      <div className="app">
        <div className="titlebar">
          <LogoIcon size={14} />
          <span>Janshare</span>
        </div>

        <div className="layout">
          {/* Barra de salas (equivalente à lista de servidores) */}
          <nav className="rail" aria-label={t("rail.label")}>
            <button className={`rail-item${room ? "" : " active"}`} onClick={leaveRoom} title={t("rail.home")}>
              <span className="rail-pill" />
              <span className="rail-icon">
                <LogoIcon size={26} />
              </span>
            </button>
            <div className="rail-separator" />
            {settings.recentRooms.map(recent => (
              <button
                key={recent.id}
                className={`rail-item${room?.roomId === recent.id ? " active" : ""}`}
                onClick={() => joinRoom(recent.id)}
                title={t("room.name", { id: recent.id })}
              >
                <span className="rail-pill" />
                <span className="rail-icon">{roomInitials(recent.id)}</span>
              </button>
            ))}
            <button className="rail-item create" onClick={createRoom} title={t("rail.create")}>
              <span className="rail-pill" />
              <span className="rail-icon">
                <PlusIcon size={22} />
              </span>
            </button>
          </nav>

          {/* Barra lateral */}
          <aside className="sidebar">
            <header className="sidebar-header">
              {room ? (
                <>
                  <span className="truncate">{t("room.name", { id: room.roomId })}</span>
                  <button className="icon-button small" onClick={copyInvite} title={t("sidebar.invite")}>
                    <PersonAddIcon size={18} />
                  </button>
                </>
              ) : (
                <span>{t("sidebar.recent")}</span>
              )}
            </header>

            <div className="sidebar-scroll">
              {room ? (
                <>
                  <div className="category">{t("sidebar.category")}</div>
                  <div className="channel active">
                    <SpeakerIcon size={18} />
                    <span>{t("channel.name")}</span>
                  </div>
                  <ul className="channel-members">
                    {[room.self, ...room.peers].filter(Boolean).map(peer => (
                      <li
                        key={peer!.id}
                        className={peer!.live && peer!.id !== room.self?.id ? "clickable" : ""}
                        onClick={() => peer!.live && peer!.id !== room.self?.id && client.current?.watch(peer!.id)}
                        title={peer!.live && peer!.id !== room.self?.id ? t("watch.button") : undefined}
                      >
                        <Avatar name={peer!.name} color={peer!.color} size={24} />
                        <span className="truncate">{peer!.name}</span>
                        {peer!.live && <span className="live-badge small">{t("live.badge")}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              ) : settings.recentRooms.length === 0 ? (
                <p className="sidebar-empty">{t("sidebar.empty")}</p>
              ) : (
                settings.recentRooms.map(recent => (
                  <div key={recent.id} className="channel recent" onClick={() => joinRoom(recent.id)}>
                    <UsersIcon size={18} />
                    <span className="truncate">{t("room.name", { id: recent.id })}</span>
                    <button
                      className="icon-button small hover-only"
                      onClick={event => {
                        event.stopPropagation();
                        updateSettings(s => forgetRoom(s, recent.id));
                      }}
                      title={t("sidebar.removeRecent")}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {room && (
              <div className="connection-panel">
                <div className="connection-info">
                  <div className={`connection-status ${room.status}`}>
                    <SignalIcon size={16} />
                    <span>
                      {room.status === "connected"
                        ? live
                          ? t("status.streaming")
                          : t("status.connected")
                        : room.status === "full"
                          ? t("status.full")
                          : room.status === "reconnecting"
                            ? t("status.reconnecting")
                            : t("status.connecting")}
                    </span>
                  </div>
                  <div className="connection-sub truncate">
                    {live && room.streamSettings ? room.streamSettings.sourceName : `${t("channel.name")} / ${room.roomId}`}
                  </div>
                </div>
                <button
                  className={`icon-button${live ? " live" : ""}`}
                  disabled={room.status !== "connected"}
                  onClick={() => (live ? client.current?.stopLive() : setGoLiveOpen(true))}
                  title={live ? t("action.stopStreaming") : t("action.shareScreen")}
                >
                  {live ? <StopShareIcon size={18} /> : <ScreenShareIcon size={18} />}
                </button>
                <button className="icon-button hangup" onClick={leaveRoom} title={t("action.disconnect")}>
                  <HangupIcon size={20} />
                </button>
              </div>
            )}

            <div className="user-panel">
              <Avatar name={settings.profile.name || "?"} color={settings.profile.color} size={32} status="online" />
              <div className="user-info">
                <div className="user-name truncate">{settings.profile.name || t("user.noName")}</div>
                <div className="user-status">{live ? t("user.live") : t("user.online")}</div>
              </div>
              <button className="icon-button" onClick={() => setSettingsOpen(true)} title={t("settings.title")}>
                <GearIcon size={18} />
              </button>
            </div>
          </aside>

          {/* Conteúdo */}
          <main className="main">
            <header className="main-header">
              {room ? (
                <>
                  <SpeakerIcon size={20} />
                  <h1>{t("channel.name")}</h1>
                  <span className="main-header-divider" />
                  <span className="main-header-sub">{t("header.inRoom", { count: (room.self ? 1 : 0) + room.peers.length })}</span>
                  {live && room.streamerStats && (
                    <span className="main-header-sub">
                      · {t("header.watching", { count: room.streamerStats.viewers.length })} ·{" "}
                      {(room.streamerStats.kbps / 1000).toFixed(1)} Mbps
                      {room.streamerStats.viewers.some(v => v.route === "relay") ? ` · ${t("header.viaTurn")}` : ""}
                    </span>
                  )}
                  <button className="btn btn-primary btn-small header-invite" onClick={copyInvite}>
                    {t("header.invite")}
                  </button>
                </>
              ) : (
                <>
                  <LogoIcon size={20} />
                  <h1>{t("rail.home")}</h1>
                </>
              )}
            </header>

            {room ? (
              <Stage
                room={room}
                onWatch={id => client.current?.watch(id)}
                onStopWatching={() => client.current?.stopWatching()}
                onGoLive={() => setGoLiveOpen(true)}
                onStopLive={() => client.current?.stopLive()}
                onInvite={copyInvite}
                onLeave={leaveRoom}
              />
            ) : (
              <div className="home">
                <div className="home-hero">
                  <div className="home-logo">
                    <LogoIcon size={48} />
                  </div>
                  <h2>{t("home.title")}</h2>
                  <p>{t("home.text")}</p>
                  <button className="btn btn-primary btn-large" onClick={createRoom}>
                    {t("rail.create")}
                  </button>
                </div>

                <form className="home-join" onSubmit={submitJoin}>
                  <h3>{t("home.join.title")}</h3>
                  <p>{t("home.join.text")}</p>
                  <div className="join-row">
                    <input
                      value={joinInput}
                      onChange={event => {
                        setJoinInput(event.target.value);
                        setJoinError(null);
                      }}
                      placeholder={inviteUrl(settings.server, "aBc123XyZ")}
                      spellCheck={false}
                    />
                    <button className="btn btn-primary" disabled={!joinInput.trim()}>
                      {t("home.join.button")}
                    </button>
                  </div>
                  {joinError && <div className="form-error">{joinError}</div>}
                </form>
              </div>
            )}
          </main>
        </div>

        {goLiveOpen && room && (
          <GoLiveModal
            current={room.streamSettings}
            audienceSize={Math.max(room.streamerStats?.viewers.length ?? 0, room.peers.length)}
            onCancel={() => setGoLiveOpen(false)}
            onConfirm={startLive}
          />
        )}

        {(settingsOpen || onboarding) && (
          <SettingsModal
            profile={settings.profile}
            server={settings.server}
            language={settings.language}
            onboarding={onboarding}
            onClose={() => setSettingsOpen(false)}
            onSave={(profile, server, nextLanguage) => {
              const serverChanged = server !== settings.server;
              updateSettings(s => ({ ...s, profile, server, language: nextLanguage }));
              client.current?.updateProfile(profile);
              setSettingsOpen(false);
              if (serverChanged && client.current) {
                toast(translate(nextLanguage, "toast.serverChanged"));
              }
            }}
          />
        )}

        {updateVersion && !updateDismissed && (
          <div className="update-banner" role="status">
            <span>
              <strong>{t("update.ready", { version: updateVersion })}</strong> {live ? t("update.onQuit") : t("update.restartHint")}
            </span>
            {!live && (
              <button className="btn btn-primary" onClick={() => void window.janshare.installUpdate()}>
                {t("update.restart")}
              </button>
            )}
            <button className="icon-button small" onClick={() => setUpdateDismissed(true)} title={t("update.later")} aria-label={t("update.later")}>
              <CloseIcon size={14} />
            </button>
          </div>
        )}

        <div className="toasts" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className={`toast ${t.kind}`}>
              {t.text}
            </div>
          ))}
        </div>
      </div>
    </I18nProvider>
  );
}
