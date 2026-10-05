import { useEffect, useState } from "react";
import type { CaptureSource } from "../env";
import { useI18n, type Translate } from "../lib/i18n";
import { bitrateFor, type FrameRate, type Resolution, type StreamSettings } from "../lib/room";
import { CloseIcon, RefreshIcon } from "./Icons";

type Props = {
  current: StreamSettings | null;
  audienceSize: number;
  onCancel(): void;
  onConfirm(settings: StreamSettings): Promise<void>;
};

const RESOLUTIONS: Resolution[] = ["720p", "1080p", "source"];
const FRAME_RATES: FrameRate[] = [15, 30, 60];

const PREFS_KEY = "janshare.streamPrefs";

type Prefs = { resolution: Resolution; fps: FrameRate; audio: boolean };

function loadPrefs(): Prefs {
  try {
    return { resolution: "1080p", fps: 30, audio: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { resolution: "1080p", fps: 30, audio: true };
  }
}

// O main manda códigos (ex.: "source-not-found"); o resto já vem legível do Chromium.
function errorText(err: unknown, t: Translate): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("source-not-found") ? t("error.sourceNotFound") : message;
}

export function GoLiveModal({ current, audienceSize, onCancel, onConfirm }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"window" | "screen">("window");
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(current?.sourceId ?? null);
  const [prefs, setPrefs] = useState<Prefs>(() =>
    current ? { resolution: current.resolution, fps: current.fps, audio: current.audio } : loadPrefs()
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setSources(await window.janshare.listSources());
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  // Miniaturas "ao vivo", como no seletor do Discord.
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const visible = sources?.filter(source => source.kind === tab) ?? [];
  const selected = sources?.find(source => source.id === selectedId) ?? null;
  const mbps = (bitrateFor(prefs) * Math.max(1, audienceSize)) / 1_000_000;

  const confirm = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    try {
      await onConfirm({ sourceId: selected.id, sourceName: selected.name, ...prefs });
    } catch (err) {
      setError(errorText(err, t));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onCancel()}>
      <div className="modal golive-modal" role="dialog" aria-modal="true" aria-labelledby="golive-title">
        <button className="modal-close" onClick={onCancel} aria-label={t("golive.close")}>
          <CloseIcon />
        </button>

        <div className="modal-header">
          <h2 id="golive-title">{current ? t("golive.titleSwitch") : t("golive.title")}</h2>
        </div>

        <div className="golive-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "window"} className={tab === "window" ? "active" : ""} onClick={() => setTab("window")}>
            {t("golive.tabApps")}
          </button>
          <button role="tab" aria-selected={tab === "screen"} className={tab === "screen" ? "active" : ""} onClick={() => setTab("screen")}>
            {t("golive.tabScreens")}
          </button>
          <button className="golive-refresh" onClick={refresh} title={t("golive.refresh")} aria-label={t("golive.refresh")}>
            <RefreshIcon size={16} />
          </button>
        </div>

        <div className="golive-grid">
          {sources === null && <div className="golive-empty">{t("golive.loading")}</div>}
          {sources !== null && visible.length === 0 && (
            <div className="golive-empty">{tab === "window" ? t("golive.emptyWindows") : t("golive.emptyScreens")}</div>
          )}
          {visible.map(source => (
            <button
              key={source.id}
              className={`golive-source${source.id === selectedId ? " selected" : ""}`}
              onClick={() => setSelectedId(source.id)}
              onDoubleClick={() => {
                setSelectedId(source.id);
                void confirm();
              }}
            >
              <div className="golive-thumb">
                <img src={source.thumbnail} alt="" />
              </div>
              <div className="golive-source-name">
                {source.icon && <img src={source.icon} alt="" />}
                <span title={source.name}>{source.name}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="golive-settings">
          <div className="golive-setting">
            <h3>{t("golive.resolution")}</h3>
            <div className="chips">
              {RESOLUTIONS.map(value => (
                <button
                  key={value}
                  className={prefs.resolution === value ? "chip active" : "chip"}
                  onClick={() => setPrefs({ ...prefs, resolution: value })}
                >
                  {value === "source" ? t("golive.resolutionSource") : value}
                </button>
              ))}
            </div>
          </div>
          <div className="golive-setting">
            <h3>{t("golive.frameRate")}</h3>
            <div className="chips">
              {FRAME_RATES.map(fps => (
                <button key={fps} className={prefs.fps === fps ? "chip active" : "chip"} onClick={() => setPrefs({ ...prefs, fps })}>
                  {fps} FPS
                </button>
              ))}
            </div>
          </div>
          <label className="toggle-row">
            <span>
              <strong>{t("golive.audio")}</strong>
              <small>{t("golive.audioHint")}</small>
            </span>
            <input
              type="checkbox"
              className="toggle"
              checked={prefs.audio}
              onChange={event => setPrefs({ ...prefs, audio: event.target.checked })}
            />
          </label>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-footer">
          <span className="golive-estimate">
            {t("golive.estimate", { mbps: mbps.toFixed(1) })}
            {audienceSize > 1 ? ` ${t("golive.estimateViewers", { count: audienceSize })}` : ""}
          </span>
          <button className="btn btn-link" onClick={onCancel}>
            {t("golive.cancel")}
          </button>
          <button className="btn btn-primary" disabled={!selected || busy} onClick={confirm}>
            {busy ? t("golive.starting") : current ? t("golive.switch") : t("golive.goLive")}
          </button>
        </div>
      </div>
    </div>
  );
}
