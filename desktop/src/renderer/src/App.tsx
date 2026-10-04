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

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts(list => [...list.slice(-3), { id, text, kind }]);
    window.setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), 4000);
  }, []);

  const onRoomEvent = useCallback(
    (event: RoomEvent) => {
      switch (event.type) {
        case "peer-joined":
          toast(`${event.peer.name} entrou na sala`);
          void window.janshare.notify("Janshare", `${event.peer.name} entrou na sala`);
          break;
        case "peer-left":
          toast(`${event.peer.name} saiu da sala`);
          break;
        case "live-started":
          toast(`${event.peer.name} começou a transmitir`, "success");
          void window.janshare.notify("Transmissão ao vivo", `${event.peer.name} começou a transmitir`);
          break;
        case "viewer-joined":
          toast(`${event.peer.name} está assistindo sua transmissão`);
          break;
        case "error":
          toast(event.message, "error");
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
    toast("Link de convite copiado!", "success");
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
    void navigator.clipboard.writeText(inviteUrl(settings.server, id)).then(() => toast("Sala criada! Link de convite copiado.", "success"));
  };

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    const id = parseRoomInput(joinInput);
    if (!id) {
      setJoinError("Link ou código inválido.");
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
    <div className="app">
      <div className="titlebar">
        <LogoIcon size={14} />
        <span>Janshare</span>
      </div>

      <div className="layout">
        {/* Barra de salas (equivalente à lista de servidores) */}
        <nav className="rail" aria-label="Salas">
          <button className={`rail-item${room ? "" : " active"}`} onClick={leaveRoom} title="Início">
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
              title={`Sala ${recent.id}`}
            >
              <span className="rail-pill" />
              <span className="rail-icon">{roomInitials(recent.id)}</span>
            </button>
          ))}
          <button className="rail-item create" onClick={createRoom} title="Criar sala">
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
                <span className="truncate">Sala {room.roomId}</span>
                <button className="icon-button small" onClick={copyInvite} title="Convidar pessoas">
                  <PersonAddIcon size={18} />
                </button>
              </>
            ) : (
              <span>Salas recentes</span>
            )}
          </header>

          <div className="sidebar-scroll">
            {room ? (
              <>
                <div className="category">Canais de transmissão</div>
                <div className="channel active">
                  <SpeakerIcon size={18} />
                  <span>Transmissão</span>
                </div>
                <ul className="channel-members">
                  {[room.self, ...room.peers].filter(Boolean).map(peer => (
                    <li
                      key={peer!.id}
                      className={peer!.live && peer!.id !== room.self?.id ? "clickable" : ""}
                      onClick={() => peer!.live && peer!.id !== room.self?.id && client.current?.watch(peer!.id)}
                      title={peer!.live && peer!.id !== room.self?.id ? "Assistir transmissão" : undefined}
                    >
                      <Avatar name={peer!.name} color={peer!.color} size={24} />
                      <span className="truncate">{peer!.name}</span>
                      {peer!.live && <span className="live-badge small">AO VIVO</span>}
                    </li>
                  ))}
                </ul>
              </>
            ) : settings.recentRooms.length === 0 ? (
              <p className="sidebar-empty">Nenhuma sala ainda. Crie uma ou cole um convite.</p>
            ) : (
              settings.recentRooms.map(recent => (
                <div key={recent.id} className="channel recent" onClick={() => joinRoom(recent.id)}>
                  <UsersIcon size={18} />
                  <span className="truncate">Sala {recent.id}</span>
                  <button
                    className="icon-button small hover-only"
                    onClick={event => {
                      event.stopPropagation();
                      updateSettings(s => forgetRoom(s, recent.id));
                    }}
                    title="Remover dos recentes"
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
                        ? "Transmitindo"
                        : "Conectado"
                      : room.status === "full"
                        ? "Sala cheia"
                        : room.status === "reconnecting"
                          ? "Reconectando…"
                          : "Conectando…"}
                  </span>
                </div>
                <div className="connection-sub truncate">
                  {live && room.streamSettings
                    ? `${room.streamSettings.sourceName}`
                    : `Transmissão / ${room.roomId}`}
                </div>
              </div>
              <button
                className={`icon-button${live ? " live" : ""}`}
                disabled={room.status !== "connected"}
                onClick={() => (live ? client.current?.stopLive() : setGoLiveOpen(true))}
                title={live ? "Parar transmissão" : "Compartilhar tela"}
              >
                {live ? <StopShareIcon size={18} /> : <ScreenShareIcon size={18} />}
              </button>
              <button className="icon-button hangup" onClick={leaveRoom} title="Desconectar">
                <HangupIcon size={20} />
              </button>
            </div>
          )}

          <div className="user-panel">
            <Avatar name={settings.profile.name || "?"} color={settings.profile.color} size={32} status="online" />
            <div className="user-info">
              <div className="user-name truncate">{settings.profile.name || "Sem nome"}</div>
              <div className="user-status">{live ? "Ao vivo" : "Online"}</div>
            </div>
            <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Configurações">
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
                <h1>Transmissão</h1>
                <span className="main-header-divider" />
                <span className="main-header-sub">
                  {(room.self ? 1 : 0) + room.peers.length} na sala
                </span>
                {live && room.streamerStats && (
                  <span className="main-header-sub">
                    · {room.streamerStats.viewers.length} assistindo · {(room.streamerStats.kbps / 1000).toFixed(1)} Mbps
                    {room.streamerStats.viewers.some(v => v.route === "relay") ? " · via TURN" : ""}
                  </span>
                )}
                <button className="btn btn-primary btn-small header-invite" onClick={copyInvite}>
                  Convidar
                </button>
              </>
            ) : (
              <>
                <LogoIcon size={20} />
                <h1>Início</h1>
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
                <h2>Compartilhe sua tela com os amigos</h2>
                <p>Crie uma sala, mande o link e transmita. O vídeo vai direto de um computador para o outro.</p>
                <button className="btn btn-primary btn-large" onClick={createRoom}>
                  Criar sala
                </button>
              </div>

              <form className="home-join" onSubmit={submitJoin}>
                <h3>Entrar em uma sala</h3>
                <p>Cole o link de convite ou o código da sala.</p>
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
                    Entrar
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
          onboarding={onboarding}
          onClose={() => setSettingsOpen(false)}
          onSave={(profile, server) => {
            const serverChanged = server !== settings.server;
            updateSettings(s => ({ ...s, profile, server }));
            client.current?.updateProfile(profile);
            setSettingsOpen(false);
            if (serverChanged && client.current) {
              toast("Servidor alterado. Entre na sala de novo para usar o novo servidor.");
            }
          }}
        />
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
