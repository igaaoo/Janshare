// Gera resources/icon.png (512x512) a partir de resources/icon.svg.
// Uso: npm run icon
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const resources = join(dirname(fileURLToPath(import.meta.url)), "../resources");
const SIZE = 512;

app.whenReady().then(async () => {
  const svg = readFileSync(join(resources, "icon.svg"), "utf8");
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true }
  });
  win.webContents.setFrameRate(1);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise(r => setTimeout(r, 300));

  const image = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE, quality: "best" });
  writeFileSync(join(resources, "icon.png"), image.toPNG());
  console.log("resources/icon.png gerado");
  app.quit();
});
