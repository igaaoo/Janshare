// Publica o build atual nos Releases do GitHub (atualização automática).
// Uso: npm run release   (build + este script)
//      node scripts/release.mjs --dry-run   (só confere, não envia nada)
//
// Substitui o "--publish always" do electron-builder, que cria dois publicadores
// em paralelo e falha com 422 "already_exists" quando o release ainda não existe.
// Aqui: cria o release como rascunho, sobe os arquivos um por vez e só então
// publica — os usuários nunca veem um release pela metade.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

class ReleaseError extends Error {}

// Lança em vez de process.exit(): no Node 24/Windows, sair com conexões de rede
// abertas derruba o processo com "Assertion failed ... UV_HANDLE_CLOSING".
function fail(message) {
  throw new ReleaseError(message);
}

// Token: variável de ambiente ou desktop/electron-builder.env (fora do git).
function readToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  const envFile = join(root, "electron-builder.env");
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, "utf8").match(/^\s*GH_TOKEN\s*=\s*"?([^"\r\n]+)"?/m);
    if (match) return match[1].trim();
  }
  fail("GH_TOKEN não encontrado (defina a variável ou crie desktop/electron-builder.env).");
}

async function main() {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const builderConfig = readFileSync(join(root, "electron-builder.yml"), "utf8");
  const owner = builderConfig.match(/^\s*owner:\s*(\S+)/m)?.[1];
  const repo = builderConfig.match(/^\s*repo:\s*(\S+)/m)?.[1];
  if (!owner || !repo) fail("owner/repo não encontrados no electron-builder.yml.");

  const tag = `v${version}`;
  const installer = `Janshare-Setup-${version}.exe`;
  const files = [installer, `${installer}.blockmap`, "latest.yml"].map(name => ({ name, path: join(root, "release", name) }));
  for (const file of files) {
    if (!existsSync(file.path)) fail(`${file.name} não existe em release/. Rode o build antes.`);
  }

  // O latest.yml precisa descrever exatamente este instalador, senão o updater rejeita.
  const installerData = readFileSync(files[0].path);
  const latest = readFileSync(files[2].path, "utf8");
  const latestVersion = latest.match(/^version:\s*(\S+)/m)?.[1];
  const latestHash = latest.match(/^sha512:\s*(\S+)/m)?.[1];
  if (latestVersion !== version) fail(`latest.yml é da versão ${latestVersion}, mas o package.json está em ${version}.`);
  if (latestHash !== createHash("sha512").update(installerData).digest("base64")) {
    fail("O hash do latest.yml não bate com o instalador. Rode o build de novo.");
  }

  const token = readToken();
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };

  async function github(path, init = {}) {
    const url = path.startsWith("https://") ? path : `${api}${path}`;
    const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
    if (!res.ok) fail(`GitHub ${init.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  console.log(`Release ${tag} → ${owner}/${repo}${dryRun ? " (dry-run)" : ""}`);
  console.log(`  instalador ${(installerData.length / 1e6).toFixed(1)} MB; latest.yml confere com o hash`);

  // Lista em vez de /releases/tags/: essa rota não enxerga rascunhos.
  const releases = await github("/releases?per_page=100");
  let release = releases.find(r => r.tag_name === tag) ?? null;
  console.log(release ? `  release existente (${release.draft ? "rascunho" : "publicado"})` : "  release novo");

  if (dryRun) {
    console.log("\n✔ Tudo certo. Rode sem --dry-run para publicar.");
    return;
  }

  if (!release) {
    release = await github("/releases", { method: "POST", body: JSON.stringify({ tag_name: tag, name: version, draft: true }) });
  }

  for (const file of files) {
    const existing = release.assets?.find(asset => asset.name === file.name);
    if (existing) await github(`/releases/assets/${existing.id}`, { method: "DELETE" });

    const body = readFileSync(file.path);
    process.stdout.write(`  enviando ${file.name}... `);
    await github(`https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "content-length": String(body.length) },
      body
    });
    console.log("ok");
  }

  if (release.draft) {
    release = await github(`/releases/${release.id}`, { method: "PATCH", body: JSON.stringify({ draft: false, make_latest: "true" }) });
  }

  console.log(`\n✔ Publicado: ${release.html_url}`);
  console.log(`  Os apps instalados vão encontrar a ${version} na próxima verificação.`);
}

main().catch(error => {
  console.error(`\n✖ ${error instanceof ReleaseError ? error.message : (error?.stack ?? error)}`);
  process.exitCode = 1;
});
