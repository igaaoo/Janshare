import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

function subscribe(channel: string, callback: (...args: any[]) => void): () => void {
  const listener = (_event: IpcRendererEvent, ...args: any[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

contextBridge.exposeInMainWorld("janshare", {
  listSources: () => ipcRenderer.invoke("sources:list"),
  selectSource: (id: string, audio: boolean) => ipcRenderer.invoke("sources:select", id, audio),
  consumeDeepLink: () => ipcRenderer.invoke("deep-link:consume"),
  onDeepLink: (callback: (url: string) => void) => subscribe("deep-link", callback),
  onGoLiveShortcut: (callback: () => void) => subscribe("shortcut:go-live", callback),
  setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke("window:always-on-top", value),
  notify: (title: string, body: string) => ipcRenderer.invoke("notify", title, body),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url)
});
