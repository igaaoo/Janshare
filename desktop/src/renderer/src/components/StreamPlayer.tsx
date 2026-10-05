import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import type { Peer, RoomSnapshot } from "../lib/room";
import { CloseIcon, ExitFullscreenIcon, FullscreenIcon, MutedIcon, PinIcon, SpeakerIcon } from "./Icons";

type Props = {
  streamer: Peer;
  room: RoomSnapshot;
  onStop(): void;
};

const VOLUME_KEY = "janshare.volume";

export function StreamPlayer({ streamer, room, onStop }: Props) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem(VOLUME_KEY) ?? 1));
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    if (video.current && video.current.srcObject !== room.remoteStream) {
      video.current.srcObject = room.remoteStream;
    }
  }, [room.remoteStream]);

  useEffect(() => {
    if (!video.current) return;
    video.current.volume = volume;
    video.current.muted = muted;
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume, muted]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Sai do "sempre no topo" ao fechar o player.
  useEffect(() => () => void window.janshare.setAlwaysOnTop(false), []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.current?.requestFullscreen();
  };

  const togglePin = () => {
    void window.janshare.setAlwaysOnTop(!pinned);
    setPinned(!pinned);
  };

  const hasAudio = Boolean(room.remoteStream?.getAudioTracks().length);
  const stats = room.viewerStats;
  const state = room.remoteState;

  let overlay: string | null = null;
  if (!room.remoteStream || state === "waiting" || state === "new" || state === "connecting") overlay = t("player.connecting");
  else if (state === "disconnected") overlay = t("player.unstable");
  else if (state === "failed") overlay = t("player.failed");

  const route = stats?.route === "direct" ? t("player.direct") : stats?.route === "relay" ? t("player.relay") : "—";

  return (
    <div ref={container} className={`player${fullscreen ? " fullscreen" : ""}`} onDoubleClick={toggleFullscreen}>
      <video ref={video} autoPlay playsInline />

      {overlay && (
        <div className="player-overlay">
          <div className="spinner" />
          <span>{overlay}</span>
        </div>
      )}

      <div className="player-top">
        <span className="live-badge">{t("live.badge")}</span>
        <span className="player-title">{streamer.name}</span>
        {stats && (
          <button className="player-stats-toggle" onClick={() => setShowStats(!showStats)} title={t("player.stats")}>
            {stats.height ? `${stats.height}p` : ""} {stats.fps ? `${stats.fps} FPS` : ""}
          </button>
        )}
      </div>

      {showStats && stats && (
        <div className="player-stats">
          <div><span>{t("player.resolution")}</span>{stats.width}×{stats.height}</div>
          <div><span>{t("player.fps")}</span>{stats.fps}</div>
          <div><span>{t("player.bitrate")}</span>{(stats.kbps / 1000).toFixed(1)} Mbps</div>
          <div><span>{t("player.latency")}</span>{stats.rttMs !== null ? `${stats.rttMs} ms` : "—"}</div>
          <div><span>{t("player.connection")}</span>{route}</div>
        </div>
      )}

      <div className="player-controls" onDoubleClick={event => event.stopPropagation()}>
        <div className="player-volume">
          <button
            className="icon-button"
            onClick={() => setMuted(!muted)}
            disabled={!hasAudio}
            title={hasAudio ? (muted ? t("player.unmute") : t("player.mute")) : t("player.noAudio")}
          >
            {muted || !hasAudio || volume === 0 ? <MutedIcon /> : <SpeakerIcon />}
          </button>
          {hasAudio && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={event => {
                setVolume(Number(event.target.value));
                setMuted(false);
              }}
              aria-label={t("player.volume")}
            />
          )}
        </div>

        <div className="player-actions">
          <button className={`icon-button${pinned ? " active" : ""}`} onClick={togglePin} title={t("player.pin")}>
            <PinIcon />
          </button>
          <button className="icon-button" onClick={toggleFullscreen} title={fullscreen ? t("player.exitFullscreen") : t("player.fullscreen")}>
            {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
          <button className="icon-button danger" onClick={onStop} title={t("player.stop")}>
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
