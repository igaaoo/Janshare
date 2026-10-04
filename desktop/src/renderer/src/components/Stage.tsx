import { useEffect, useRef } from "react";
import type { Peer, RoomSnapshot } from "../lib/room";
import { Avatar } from "./Avatar";
import { EyeIcon, HangupIcon, PersonAddIcon, ScreenShareIcon, StopShareIcon } from "./Icons";
import { StreamPlayer } from "./StreamPlayer";

type Props = {
  room: RoomSnapshot;
  onWatch(peerId: string): void;
  onStopWatching(): void;
  onGoLive(): void;
  onStopLive(): void;
  onInvite(): void;
  onLeave(): void;
};

function LocalPreview({ stream }: { stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);
  return <video ref={video} autoPlay playsInline muted />;
}

function Tile({ peer, room, isSelf, onWatch }: { peer: Peer; room: RoomSnapshot; isSelf: boolean; onWatch(): void }) {
  const isLocalLive = isSelf && room.localStream;
  const viewers = isSelf ? room.streamerStats?.viewers.length ?? 0 : 0;

  return (
    <div className={`tile${peer.live ? " tile-live" : ""}`}>
      {isLocalLive ? (
        <>
          <LocalPreview stream={room.localStream!} />
          <div className="tile-caption">
            <span className="live-badge">AO VIVO</span>
            <span>Sua transmissão</span>
            <span className="tile-viewers" title="Espectadores">
              <EyeIcon size={14} /> {viewers}
            </span>
          </div>
        </>
      ) : peer.live ? (
        <>
          <div className="tile-center">
            <Avatar name={peer.name} color={peer.color} size={64} />
            <button className="btn btn-watch" onClick={onWatch}>
              Assistir transmissão
            </button>
          </div>
          <div className="tile-caption">
            <span className="live-badge">AO VIVO</span>
            <span>{peer.name}</span>
          </div>
        </>
      ) : (
        <>
          <div className="tile-center" style={{ background: peer.color }}>
            <Avatar name={peer.name} color={peer.color} size={80} />
          </div>
          <div className="tile-caption">
            <span>
              {peer.name}
              {isSelf ? " (você)" : ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export function Stage({ room, onWatch, onStopWatching, onGoLive, onStopLive, onInvite, onLeave }: Props) {
  const everyone = room.self ? [room.self, ...room.peers] : room.peers;
  const streamer = room.watching ? room.peers.find(p => p.id === room.watching) : undefined;
  const live = Boolean(room.localStream);
  const alone = room.status === "connected" && room.peers.length === 0;

  return (
    <div className="stage">
      {room.status !== "connected" ? (
        <div className="stage-message">
          {room.status === "full" ? (
            <>
              <h2>A sala está cheia</h2>
              <p>Esta sala já tem o número máximo de pessoas.</p>
            </>
          ) : (
            <>
              <div className="spinner" />
              <p>{room.status === "reconnecting" ? "Conexão perdida. Reconectando…" : "Conectando à sala…"}</p>
            </>
          )}
        </div>
      ) : streamer ? (
        <div className="stage-focus">
          <StreamPlayer streamer={streamer} room={room} onStop={onStopWatching} />
          <div className="stage-strip">
            {everyone.map(peer => (
              <div key={peer.id} className="strip-item" title={peer.name}>
                <Avatar name={peer.name} color={peer.color} size={40} live={peer.live} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="stage-grid-wrap">
          <div className={`stage-grid count-${Math.min(everyone.length, 4)}`}>
            {everyone.map(peer => (
              <Tile key={peer.id} peer={peer} room={room} isSelf={peer.id === room.self?.id} onWatch={() => onWatch(peer.id)} />
            ))}
          </div>
          {alone && (
            <div className="stage-invite">
              <p>Ninguém mais por aqui ainda.</p>
              <button className="btn btn-primary" onClick={onInvite}>
                <PersonAddIcon size={18} /> Copiar convite
              </button>
            </div>
          )}
        </div>
      )}

      <div className="call-controls">
        <button
          className={`call-button${live ? " active" : ""}`}
          onClick={live ? onStopLive : onGoLive}
          disabled={room.status !== "connected"}
          title={live ? "Parar transmissão" : "Compartilhar sua tela"}
        >
          {live ? <StopShareIcon size={22} /> : <ScreenShareIcon size={22} />}
        </button>
        <button className="call-button" onClick={onInvite} title="Copiar convite">
          <PersonAddIcon size={22} />
        </button>
        <button className="call-button hangup" onClick={onLeave} title="Sair da sala">
          <HangupIcon size={24} />
        </button>
      </div>
    </div>
  );
}
