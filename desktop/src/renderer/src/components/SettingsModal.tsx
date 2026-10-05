import { useEffect, useState } from "react";
import { LANGUAGES, translate, type Language, type Translate } from "../lib/i18n";
import { AVATAR_COLORS, DEFAULT_SERVER, type Profile } from "../lib/settings";
import { Avatar } from "./Avatar";
import { CloseIcon } from "./Icons";

type Props = {
  profile: Profile;
  server: string;
  language: Language;
  /** Primeira execução: sem botão de fechar até escolher um nome. */
  onboarding?: boolean;
  onClose(): void;
  onSave(profile: Profile, server: string, language: Language): void;
};

export function SettingsModal({ profile, server, language: initialLanguage, onboarding, onClose, onSave }: Props) {
  const [name, setName] = useState(profile.name);
  const [color, setColor] = useState(profile.color);
  const [serverUrl, setServerUrl] = useState(server);
  const [language, setLanguage] = useState(initialLanguage);
  // O modal já aparece no idioma escolhido, antes de salvar.
  const t: Translate = (key, params) => translate(language, key, params);

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
    if (valid) onSave({ name: name.trim().slice(0, 32), color }, trimmedServer, language);
  };

  return (
    <div className="modal-backdrop">
      <form
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        lang={language === "pt" ? "pt-BR" : "en"}
        onSubmit={event => {
          event.preventDefault();
          save();
        }}
      >
        {!onboarding && (
          <button type="button" className="modal-close" onClick={onClose} aria-label={t("settings.close")}>
            <CloseIcon />
          </button>
        )}

        <div className="modal-header">
          <h2>{onboarding ? t("settings.welcome") : t("settings.title")}</h2>
          {onboarding && <p>{t("settings.welcomeText")}</p>}
        </div>

        <div className="modal-body">
          <div className="profile-preview">
            <Avatar name={name || "?"} color={color} size={80} />
          </div>

          <label className="field">
            <span>{t("settings.name")}</span>
            <input autoFocus value={name} maxLength={32} onChange={event => setName(event.target.value)} placeholder={t("settings.namePlaceholder")} />
          </label>

          <div className="field">
            <span>{t("settings.color")}</span>
            <div className="swatches">
              {AVATAR_COLORS.map(swatch => (
                <button
                  type="button"
                  key={swatch}
                  className={swatch === color ? "swatch active" : "swatch"}
                  style={{ background: swatch }}
                  onClick={() => setColor(swatch)}
                  aria-label={t("settings.colorOption", { value: swatch })}
                />
              ))}
            </div>
          </div>

          <div className="field">
            <span>{t("settings.language")}</span>
            <div className="chips">
              {LANGUAGES.map(option => (
                <button
                  type="button"
                  key={option.value}
                  className={language === option.value ? "chip active" : "chip"}
                  onClick={() => setLanguage(option.value)}
                  lang={option.value === "pt" ? "pt-BR" : "en"}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {!onboarding && (
            <>
              <label className="field">
                <span>{t("settings.server")}</span>
                <input value={serverUrl} onChange={event => setServerUrl(event.target.value)} spellCheck={false} />
              </label>
              {trimmedServer !== DEFAULT_SERVER && (
                <button type="button" className="btn btn-link btn-small" onClick={() => setServerUrl(DEFAULT_SERVER)}>
                  {t("settings.restoreServer")}
                </button>
              )}

              <div className="field">
                <span>{t("settings.shortcuts")}</span>
                <div className="shortcut-row">
                  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> {t("settings.shortcutGoLive")}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <span className="app-version">Janshare v{__APP_VERSION__}</span>
          {!onboarding && (
            <button type="button" className="btn btn-link" onClick={onClose}>
              {t("settings.cancel")}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            {onboarding ? t("settings.continue") : t("settings.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
