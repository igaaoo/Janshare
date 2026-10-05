import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    // Versão do app enviada no hello (estatísticas de versões em uso).
    define: { __APP_VERSION__: JSON.stringify(pkg.version) }
  }
});
