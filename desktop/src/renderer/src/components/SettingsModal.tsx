import { useEffect, useState } from "react";
import { AVATAR_COLORS, DEFAULT_SERVER, type Profile } from "../lib/settings";
import { Avatar } from "./Avatar";
import { CloseIcon } from "./Icons";

type Props = {
  profile: Profile;
  server: string;
  /** Primeira execução: sem botão de fechar até escolher um nome. */
  onboarding?: boolean;
  onClose(): void;
  onSave(profile: Profile, server: string): void;
};

export function SettingsModal({ profile, server, onboarding, onClose, onSave }: Props) {
  const [name, setName] = useState(profile.name);
  const [color, setColor] = useState(profile.color);
  const [serverUrl, setServerUrl] = useState(server);

  const trimmedServer = serverUrl.trim().replace(/\/+$/, "");
  // http só para o `wrangler dev` local.
  const valid =
    name.trim().length > 0 && /^(https:\/\/[^\s/]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/.test(trimmedServer);

  useEffect(() => {
    if (onboarding) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onboarding, onClose]);

  const save = () => {
    if (valid) onSave({ name: name.trim().slice(0, 32), color }, trimmedServer);
  };

  return (
    <div className="modal-backdrop">
      <form
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        onSubmit={event => {
          event.preventDefault();
          save();
        }}
      >
        {!onboarding && (
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            <CloseIcon />
          </button>
        )}

        <div className="modal-header">
          <h2>{onboarding ? "Boas-vindas!" : "Configurações"}</h2>
          {onboarding && <p>Como você quer aparecer para quem estiver na sala?</p>}
        </div>

        <div className="modal-body">
          <div className="profile-preview">
            <Avatar name={name || "?"} color={color} size={80} />
          </div>

          <label className="field">
            <span>Nome de exibição</span>
            <input autoFocus value={name} maxLength={32} onChange={event => setName(event.target.value)} placeholder="Seu nome" />
          </label>

          <div className="field">
            <span>Cor do avatar</span>
            <div className="swatches">
              {AVATAR_COLORS.map(swatch => (
                <button
                  type="button"
                  key={swatch}
                  className={swatch === color ? "swatch active" : "swatch"}
                  style={{ background: swatch }}
                  onClick={() => setColor(swatch)}
                  aria-label={`Cor ${swatch}`}
                />
              ))}
            </div>
          </div>

          {!onboarding && (
            <>
              <label className="field">
                <span>Servidor de signaling</span>
                <input value={serverUrl} onChange={event => setServerUrl(event.target.value)} spellCheck={false} />
              </label>
              {trimmedServer !== DEFAULT_SERVER && (
                <button type="button" className="btn btn-link btn-small" onClick={() => setServerUrl(DEFAULT_SERVER)}>
                  Restaurar padrão
                </button>
              )}

              <div className="field">
                <span>Atalhos</span>
                <div className="shortcut-row">
                  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> iniciar / parar transmissão
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          {!onboarding && (
            <button type="button" className="btn btn-link" onClick={onClose}>
              Cancelar
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            {onboarding ? "Continuar" : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
