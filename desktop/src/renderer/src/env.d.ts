export type CaptureSource = {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  icon: string | null;
};

declare global {
  interface Window {
    janshare: {
      listSources(): Promise<CaptureSource[]>;
      selectSource(id: string, audio: boolean): Promise<void>;
      consumeDeepLink(): Promise<string | null>;
      onDeepLink(callback: (url: string) => void): () => void;
      onGoLiveShortcut(callback: () => void): () => void;
      setAlwaysOnTop(value: boolean): Promise<void>;
      notify(title: string, body: string): Promise<void>;
      openExternal(url: string): Promise<void>;
    };
  }
}
