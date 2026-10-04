import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// O app se chamava ScShare: move as chaves antigas antes de qualquer leitura.
for (const key of Object.keys(localStorage)) {
  if (!key.startsWith("scshare.")) continue;
  const next = `janshare.${key.slice("scshare.".length)}`;
  if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key)!);
  localStorage.removeItem(key);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
