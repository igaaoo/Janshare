import { useEffect, useRef } from "react";
import { useI18n } from "../lib/i18n";
import type { Peer, RoomSnapshot } from "../lib/room";
import { Avatar } from "./Avatar";
import {
  EyeIcon,
  HangupIcon,
  PersonAddIcon,
  ScreenShareIcon,
  StopShareIcon,
} from "./Icons";
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

function Tile({
  peer,
  room,
  isSelf,
  onWatch,
}: {
  peer: Peer;
  room: RoomSnapshot;
  isSelf: boolean;
  onWatch(): void;
}) {
  const { t } = useI18n();
  const isLocalLive = isSelf && room.localStream;
  const viewers = isSelf ? (room.streamerStats?.viewers.length ?? 0) : 0;

  return (
    <div className={`tile${peer.live ? " tile-live" : ""}`}>
      {isLocalLive ? (
        <>
          <LocalPreview stream={room.localStream!} />
          <div className="tile-caption">
            <span className="live-badge">{t("live.badge")}</span>
            <span>{t("stage.yourStream")}</span>
            <span className="tile-viewers" title={t("stage.viewers")}>
              <EyeIcon size={14} /> {viewers}
            </span>
          </div>
        </>
      ) : peer.live ? (
        <>
          <div className="tile-center">
            <Avatar name={peer.name} color={peer.color} size={64} />
            <button className="btn btn-watch" onClick={onWatch}>
              {t("watch.button")}
            </button>
          </div>
          <div className="tile-caption">
            <span className="live-badge">{t("live.badge")}</span>
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
              {isSelf ? ` ${t("stage.you")}` : ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export function Stage({
  room,
  onWatch,
  onStopWatching,
  onGoLive,
  onStopLive,
  onInvite,
  onLeave,
}: Props) {
  const { t } = useI18n();
  const everyone = room.self ? [room.self, ...room.peers] : room.peers;
  const streamer = room.watching
    ? room.peers.find((p) => p.id === room.watching)
    : undefined;
  const live = Boolean(room.localStream);
  const alone = room.status === "connected" && room.peers.length === 0;

  return (
    <div className="stage">
      {room.status !== "connected" ? (
        <div className="stage-message">
          {room.status === "full" ? (
            <>
              <h2>{t("stage.full.title")}</h2>
              <p>{t("stage.full.text")}</p>
            </>
          ) : (
            <>
              <div className="spinner" />
              <p>
                {room.status === "reconnecting"
                  ? t("stage.reconnecting")
                  : t("stage.connecting")}
              </p>
            </>
          )}
        </div>
      ) : streamer ? (
        <div className="stage-focus">
          <StreamPlayer
            streamer={streamer}
            room={room}
            onStop={onStopWatching}
          />
          <div className="stage-strip">
            {everyone.map((peer) => (
              <div key={peer.id} className="strip-item" title={peer.name}>
                <Avatar
                  name={peer.name}
                  color={peer.color}
                  size={40}
                  live={peer.live}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="stage-grid-wrap">
          <div className={`stage-grid count-${Math.min(everyone.length, 4)}`}>
            {everyone.map((peer) => (
              <Tile
                key={peer.id}
                peer={peer}
                room={room}
                isSelf={peer.id === room.self?.id}
                onWatch={() => onWatch(peer.id)}
              />
            ))}
          </div>
          {alone && (
            <div className="stage-invite">
              <p>{t("stage.alone")}</p>
              <button className="btn btn-primary" onClick={onInvite}>
                <PersonAddIcon size={18} /> {t("action.copyInvite")}
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
          title={live ? t("action.stopStreaming") : t("action.shareYourScreen")}
        >
          {live ? <StopShareIcon size={22} /> : <ScreenShareIcon size={22} />}
        </button>
        <button
          className="call-button"
          onClick={onInvite}
          title={t("action.copyInvite")}
        >
          <PersonAddIcon size={22} />
        </button>
        <button
          className="call-button hangup"
          onClick={onLeave}
          title={t("action.leaveRoom")}
        >
          <HangupIcon size={24} />
        </button>
      </div>
    </div>
  );
}
