import { useEffect, useState } from "react";
import type { CaptureSource } from "../env";
import { bitrateFor, type FrameRate, type Resolution, type StreamSettings } from "../lib/room";
import { CloseIcon, RefreshIcon } from "./Icons";

type Props = {
  current: StreamSettings | null;
  audienceSize: number;
  onCancel(): void;
  onConfirm(settings: StreamSettings): Promise<void>;
};

const RESOLUTIONS: Array<{ value: Resolution; label: string }> = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "source", label: "Fonte" }
];
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

export function GoLiveModal({ current, audienceSize, onCancel, onConfirm }: Props) {
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onCancel()}>
      <div className="modal golive-modal" role="dialog" aria-modal="true" aria-labelledby="golive-title">
        <button className="modal-close" onClick={onCancel} aria-label="Fechar">
          <CloseIcon />
        </button>

        <div className="modal-header">
          <h2 id="golive-title">{current ? "Trocar transmissão" : "Compartilhamento de tela"}</h2>
        </div>

        <div className="golive-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "window"} className={tab === "window" ? "active" : ""} onClick={() => setTab("window")}>
            Aplicativos
          </button>
          <button role="tab" aria-selected={tab === "screen"} className={tab === "screen" ? "active" : ""} onClick={() => setTab("screen")}>
            Telas
          </button>
          <button className="golive-refresh" onClick={refresh} title="Atualizar lista" aria-label="Atualizar lista">
            <RefreshIcon size={16} />
          </button>
        </div>

        <div className="golive-grid">
          {sources === null && <div className="golive-empty">Carregando fontes…</div>}
          {sources !== null && visible.length === 0 && (
            <div className="golive-empty">{tab === "window" ? "Nenhuma janela aberta encontrada." : "Nenhuma tela encontrada."}</div>
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
            <h3>Resolução</h3>
            <div className="chips">
              {RESOLUTIONS.map(option => (
                <button
                  key={option.value}
                  className={prefs.resolution === option.value ? "chip active" : "chip"}
                  onClick={() => setPrefs({ ...prefs, resolution: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="golive-setting">
            <h3>Taxa de quadros</h3>
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
              <strong>Compartilhar áudio do sistema</strong>
              <small>Transmite todo o som do computador, inclusive o de outras chamadas.</small>
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
            Upload estimado: ~{mbps.toFixed(1)} Mbps
            {audienceSize > 1 ? ` (${audienceSize} espectadores)` : ""}
          </span>
          <button className="btn btn-link" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={!selected || busy} onClick={confirm}>
            {busy ? "Iniciando…" : current ? "Trocar" : "Ao vivo"}
          </button>
        </div>
      </div>
    </div>
  );
}
