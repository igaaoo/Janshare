import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Notification,
  session,
  shell,
  type DesktopCapturerSource
} from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { autoUpdater } from "electron-updater";
import audioHelper from "../../resources/audio-capture.exe?asset&asarUnpack";
import icon from "../../resources/icon.png?asset";

const PROTOCOL = "janshare";
const GO_LIVE_SHORTCUT = "CommandOrControl+Shift+S";

let win: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

// Fontes listadas pelo seletor; o renderer escolhe uma pelo id e em seguida
// chama getDisplayMedia, que cai no handler abaixo.
const sourceCache = new Map<string, DesktopCapturerSource>();
let selected: { source: DesktopCapturerSource; audio: boolean } | null = null;

// Helper nativo que captura o som do sistema sem o Discord (native/audio-capture.cpp).
// Um processo compartilhado por contagem de referências: trocar a fonte durante a
// transmissão não derruba o áudio.
let audioProc: ChildProcessWithoutNullStreams | null = null;
let audioReady: Promise<void> | null = null;
let audioUsers = 0;

function startAudioHelper(): Promise<void> {
  if (audioReady) return audioReady;

  const proc = spawn(audioHelper, [], { windowsHide: true });
  audioProc = proc;
  let stderr = "";
  proc.stderr.on("data", data => (stderr += data));
  proc.stdout.on("data", (chunk: Buffer) => win?.webContents.send("audio:chunk", chunk));
  proc.once("exit", () => {
    if (audioProc !== proc) return;
    audioProc = null;
    audioReady = null;
    audioUsers = 0;
  });

  // O helper escreve continuamente (inclusive silêncio): o primeiro chunk confirma que funcionou.
  audioReady = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("O capturador de áudio não respondeu.")), 3000);
    proc.stdout.once("data", () => {
      clearTimeout(timer);
      resolve();
    });
    proc.once("error", reject);
    proc.once("exit", code => reject(new Error(stderr.trim() || `O capturador de áudio saiu (código ${code}).`)));
  });
  audioReady.catch(() => stopAudioHelper());
  return audioReady;
}

function stopAudioHelper() {
  const proc = audioProc;
  audioProc = null;
  audioReady = null;
  audioUsers = 0;
  if (!proc) return;
  proc.stdin.end();
  proc.kill();
}

// A transmissão chega depois do clique em "Assistir"; o som não pode ser bloqueado.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function findDeepLink(argv: string[]): string | null {
  return argv.find(arg => arg.startsWith(`${PROTOCOL}://`)) ?? null;
}

function deliverDeepLink(url: string) {
  if (win && !win.webContents.isLoading()) {
    win.webContents.send("deep-link", url);
  } else {
    pendingDeepLink = url;
  }
}

function focusWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// O app se chamava ScShare: na primeira execução copia a pasta de dados antiga
// (perfil, salas recentes) antes que o lock de instância crie a nova.
try {
  const current = app.getPath("userData");
  const legacy = join(app.getPath("appData"), "ScShare");
  if (!existsSync(current) && existsSync(legacy)) cpSync(legacy, current, { recursive: true });
} catch {
  // Pasta antiga em uso ou inacessível: começa do zero.
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    focusWindow();
    const url = findDeepLink(argv);
    if (url) deliverDeepLink(url);
  });

  pendingDeepLink = findDeepLink(process.argv);
  app.whenReady().then(start);
}

// Atualização automática pelos Releases do GitHub (publish no electron-builder.yml).
// Baixa em segundo plano; instala ao fechar o app ou quando o usuário clica em
// "Reiniciar" no aviso do renderer.
const UPDATE_CHECK_MS = 4 * 3600_000;
let updateReady: string | null = null;

function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", info => {
    updateReady = info.version;
    win?.webContents.send("update:ready", info.version);
  });
  autoUpdater.on("error", error => console.error("Atualização falhou:", error));

  const check = () => autoUpdater.checkForUpdates().catch(error => console.error("Atualização falhou:", error));
  void check();
  setInterval(check, UPDATE_CHECK_MS);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    backgroundColor: "#313338",
    icon,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#1e1f22", symbolColor: "#b5bac1", height: 30 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.once("ready-to-show", () => win?.show());
  win.on("focus", () => win?.flashFrame(false));
  win.on("closed", () => (win = null));
  // Renderer recarregou ou caiu: ninguém mais consome o áudio.
  win.webContents.on("did-start-loading", stopAudioHelper);
  win.webContents.on("render-process-gone", stopAudioHelper);

  // Links externos abrem no navegador; o app nunca navega para fora.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", event => event.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function start() {
  app.setAppUserModelId("dev.janshare.desktop");

  // Microfone e câmera ficam sempre negados: o app não usa e, se o renderer fosse
  // comprometido, ninguém liga o microfone sem aviso. getDisplayMedia pede "media"
  // com mediaTypes vazio; microfone/câmera pedem ["audio"]/["video"].
  const allowed = new Set(["display-capture", "notifications", "fullscreen", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === "media") {
      callback("mediaTypes" in details && (details.mediaTypes ?? []).length === 0);
      return;
    }
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const choice = selected;
    selected = null;
    if (!choice) {
      callback({});
      return;
    }
    // "loopback" = todo o áudio do sistema (só Windows).
    callback(choice.audio ? { video: choice.source, audio: "loopback" } : { video: choice.source });
  });

  ipcMain.handle("sources:list", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true
    });
    const ownId = win?.getMediaSourceId();

    sourceCache.clear();
    return sources
      .filter(source => source.id !== ownId && !source.thumbnail.isEmpty())
      .map(source => {
        sourceCache.set(source.id, source);
        return {
          id: source.id,
          name: source.name,
          kind: source.id.startsWith("screen:") ? "screen" : "window",
          thumbnail: source.thumbnail.toDataURL(),
          icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null
        };
      });
  });

  ipcMain.handle("sources:select", (_event, id: string, audio: boolean) => {
    const source = sourceCache.get(id);
    if (!source) throw new Error("Fonte não encontrada. Atualize a lista e tente de novo.");
    selected = { source, audio: Boolean(audio) };
  });

  ipcMain.handle("audio:start", async () => {
    audioUsers++;
    try {
      await startAudioHelper();
    } catch (error) {
      audioUsers = Math.max(0, audioUsers - 1);
      throw error;
    }
  });

  ipcMain.handle("audio:stop", () => {
    audioUsers = Math.max(0, audioUsers - 1);
    if (audioUsers === 0) stopAudioHelper();
  });

  ipcMain.handle("update:pending", () => updateReady);
  ipcMain.handle("update:install", () => {
    if (updateReady) autoUpdater.quitAndInstall(true, true);
  });

  ipcMain.handle("deep-link:consume", () => {
    const url = pendingDeepLink;
    pendingDeepLink = null;
    return url;
  });

  ipcMain.handle("window:always-on-top", (_event, value: boolean) => {
    win?.setAlwaysOnTop(Boolean(value), "floating");
  });

  // Só notifica quando o app não está em foco; senão o renderer mostra um toast.
  ipcMain.handle("notify", (_event, title: string, body: string) => {
    if (!win || win.isFocused()) return;
    const notification = new Notification({ title: String(title), body: String(body), icon });
    notification.on("click", focusWindow);
    notification.show();
    win.flashFrame(true);
  });

  ipcMain.handle("open-external", (_event, url: string) => {
    if (typeof url === "string" && url.startsWith("https://")) shell.openExternal(url);
  });

  createWindow();
  setupUpdates();

  globalShortcut.register(GO_LIVE_SHORTCUT, () => {
    focusWindow();
    win?.webContents.send("shortcut:go-live");
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopAudioHelper();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
