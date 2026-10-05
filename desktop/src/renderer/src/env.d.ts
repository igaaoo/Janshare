export type CaptureSource = {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  icon: string | null;
};

declare global {
  /** Versão do package.json, injetada pelo electron.vite.config.ts. */
  const __APP_VERSION__: string;

  interface Window {
    janshare: {
      listSources(): Promise<CaptureSource[]>;
      selectSource(id: string, audio: boolean): Promise<void>;
      /** Liga o capturador nativo (som do sistema sem o Discord); rejeita se não funcionar. */
      startAudio(): Promise<void>;
      stopAudio(): Promise<void>;
      /** PCM s16le, 2 canais, 48 kHz. */
      onAudioChunk(callback: (chunk: Uint8Array) => void): () => void;
      /** Versão já baixada e pronta para instalar, se houver. */
      pendingUpdate(): Promise<string | null>;
      onUpdateReady(callback: (version: string) => void): () => void;
      /** Fecha o app, instala a atualização e abre de novo. */
      installUpdate(): Promise<void>;
      consumeDeepLink(): Promise<string | null>;
      onDeepLink(callback: (url: string) => void): () => void;
      onGoLiveShortcut(callback: () => void): () => void;
      setAlwaysOnTop(value: boolean): Promise<void>;
      notify(title: string, body: string): Promise<void>;
      openExternal(url: string): Promise<void>;
    };
  }
}
