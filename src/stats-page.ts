import type { StatsDay, StatsSummary } from "./stats";

const number = new Intl.NumberFormat("pt-BR");
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const CHART_DAYS = 30;

// Nome em português a partir do código ISO (bandeiras em emoji não aparecem no Windows).
function countryName(country: string): string {
  if (!/^[A-Z]{2}$/.test(country) || country === "XX") return "Outros";
  try {
    return new Intl.DisplayNames(["pt-BR"], { type: "region" }).of(country) ?? country;
  } catch {
    return country;
  }
}

function shortDate(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}

/** Últimos N dias, preenchendo com zero os dias sem registro. */
function lastDays(days: StatsDay[], count: number): StatsDay[] {
  const byDay = new Map(days.map(d => [d.day, d]));
  const result: StatsDay[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    result.push(
      byDay.get(day) ?? { day, users: 0, newUsers: 0, sessions: 0, rooms: 0, streams: 0, streamHours: 0, watchHours: 0, peak: 0 }
    );
  }
  return result;
}

function tile(key: string, label: string, value: string, hint = ""): string {
  return `<div class="tile"><span class="tile-label">${label}</span><strong data-k="${key}">${value}</strong>${
    hint ? `<span class="tile-hint">${hint}</span>` : ""
  }</div>`;
}

function chart(days: StatsDay[]): string {
  const max = Math.max(1, ...days.map(d => d.users));
  const bars = days
    .map(d => {
      const height = (d.users / max) * 100;
      const label = `${shortDate(d.day)}: ${number.format(d.users)} ${d.users === 1 ? "usuário" : "usuários"}`;
      return `<div class="bar-slot" tabindex="0" aria-label="${label}">
        <div class="bar" style="height:${height.toFixed(2)}%"></div>
        <div class="tip"><strong>${number.format(d.users)}</strong> ${d.users === 1 ? "usuário" : "usuários"}<br><span>${shortDate(
          d.day
        )} · ${number.format(d.streams)} transm. · ${decimal.format(d.streamHours)} h</span></div>
      </div>`;
    })
    .join("");

  return `<figure class="chart">
    <figcaption>Usuários ativos por dia <span>(últimos ${CHART_DAYS} dias)</span></figcaption>
    <div class="plot">
      <div class="y-max">${number.format(max)}</div>
      <div class="grid"></div>
      <div class="bars">${bars}</div>
    </div>
    <div class="x-axis"><span>${shortDate(days[0].day)}</span><span>${shortDate(days[days.length - 1].day)}</span></div>
  </figure>`;
}

function table(days: StatsDay[]): string {
  const rows = [...days]
    .reverse()
    .map(
      d => `<tr><td>${shortDate(d.day)}</td><td>${number.format(d.users)}</td><td>${number.format(d.newUsers)}</td><td>${number.format(
        d.streams
      )}</td><td>${decimal.format(d.streamHours)}</td><td>${decimal.format(d.watchHours)}</td><td>${number.format(d.peak)}</td></tr>`
    )
    .join("");
  return `<details class="table-view"><summary>Ver dados em tabela</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>Dia</th><th>Ativos</th><th>Novos</th><th>Transmissões</th><th>Horas transm.</th><th>Horas assistidas</th><th>Pico online</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </details>`;
}

export function statsPage(stats: StatsSummary, icon: string): string {
  const days = lastDays(stats.days, CHART_DAYS);
  const t = stats.totals;
  const countries = stats.countries.length
    ? stats.countries
        .map(c => `<li><span>${countryName(c.country)}</span><span>${number.format(c.users)}</span></li>`)
        .join("")
    : `<li class="empty">Ainda sem dados.</li>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Janshare em números</title>
  <meta name="description" content="Estatísticas públicas e anônimas de uso do Janshare, compartilhamento de tela P2P." />
  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}" />
  <style>
    :root { color-scheme: dark; --bg: #313338; --surface: #2b2d31; --ink: #f2f3f5; --ink-2: #b5bac1; --muted: #80848e; --line: #3f4147; --bar: #6f7af5; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink-2); font-family: "Noto Sans", "Segoe UI", system-ui, sans-serif; }
    main { max-width: 960px; margin: 0 auto; padding: 40px 20px 56px; }
    header { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
    header img { width: 48px; height: 48px; }
    h1 { color: var(--ink); font-size: 26px; margin: 0; }
    header p { margin: 4px 0 0; font-size: 14px; }
    .online { display: inline-flex; align-items: center; gap: 8px; background: var(--surface); padding: 8px 14px; border-radius: 999px; margin-bottom: 20px; font-size: 14px; }
    .online strong { color: var(--ink); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #23a55a; box-shadow: 0 0 0 3px rgba(35,165,90,.2); }
    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .tile { background: var(--surface); border-radius: 8px; padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; }
    .tile-label { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
    .tile strong { color: var(--ink); font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .tile-hint { font-size: 12px; color: var(--muted); }
    .panel { background: var(--surface); border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .chart { margin: 0; }
    figcaption { color: var(--ink); font-weight: 600; margin-bottom: 16px; }
    figcaption span { color: var(--muted); font-weight: 400; }
    .plot { position: relative; height: 200px; padding-left: 36px; }
    .y-max { position: absolute; left: 0; top: -7px; font-size: 11px; color: var(--muted); }
    .grid { position: absolute; left: 36px; right: 0; top: 0; bottom: 0; border-top: 1px dashed var(--line); border-bottom: 1px solid var(--line); }
    .bars { position: relative; height: 100%; display: flex; align-items: flex-end; gap: 2px; }
    .bar-slot { position: relative; flex: 1; height: 100%; display: flex; align-items: flex-end; outline: none; cursor: default; }
    .bar { width: 100%; min-height: 0; background: var(--bar); border-radius: 4px 4px 0 0; }
    .bar-slot:hover .bar, .bar-slot:focus .bar { filter: brightness(1.2); }
    .tip { display: none; position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); background: #111214; color: var(--ink-2); padding: 8px 10px; border-radius: 6px; font-size: 12px; white-space: nowrap; z-index: 2; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,.4); }
    .tip strong { color: var(--ink); font-size: 14px; }
    .tip span { color: var(--muted); }
    .bar-slot:hover .tip, .bar-slot:focus .tip { display: block; }
    .bar-slot:first-child .tip { left: 0; transform: none; }
    .bar-slot:last-child .tip { left: auto; right: 0; transform: none; }
    .x-axis { display: flex; justify-content: space-between; padding-left: 36px; margin-top: 6px; font-size: 11px; color: var(--muted); }
    .table-view { margin-top: 16px; font-size: 13px; }
    .table-view summary { cursor: pointer; color: var(--ink-2); }
    .table-wrap { overflow-x: auto; margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th, td { padding: 6px 10px; text-align: right; border-bottom: 1px solid var(--line); white-space: nowrap; }
    th:first-child, td:first-child { text-align: left; }
    th { color: var(--muted); font-weight: 600; }
    td { color: var(--ink-2); }
    .columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    h2 { color: var(--ink); font-size: 16px; margin: 0 0 12px; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 14px; font-variant-numeric: tabular-nums; }
    li:last-child { border-bottom: 0; }
    li span:last-child { color: var(--ink); }
    li.empty { color: var(--muted); }
    .about { font-size: 14px; line-height: 1.6; margin: 0; }
    footer { margin-top: 24px; font-size: 12px; color: var(--muted); line-height: 1.6; }
    a { color: #00a8fc; }
  </style>
</head>
<body>
  <main>
    <header>
      <img src="data:image/svg+xml,${encodeURIComponent(icon)}" alt="" />
      <div>
        <h1>Janshare em números</h1>
        <p>Compartilhamento de tela P2P para Windows, gratuito e sem cadastro.</p>
      </div>
    </header>

    <div class="online"><span class="dot" aria-hidden="true"></span><strong data-k="online">${number.format(stats.online)}</strong> online agora</div>

    <section class="tiles" aria-label="Totais">
      ${tile("users", "Usuários", number.format(t.users), "instalações únicas")}
      ${tile("last30", "Ativos em 30 dias", number.format(stats.active.last30), `${number.format(stats.active.today)} hoje`)}
      ${tile("streams", "Transmissões", number.format(t.streams))}
      ${tile("streamHours", "Horas transmitidas", decimal.format(t.streamHours))}
      ${tile("watchHours", "Horas assistidas", decimal.format(t.watchHours), "somando todos os espectadores")}
      ${tile("rooms", "Salas criadas", number.format(t.rooms))}
      ${tile("sessions", "Sessões", number.format(t.sessions), `${decimal.format(t.sessionHours)} h em salas`)}
      ${tile("peakOnline", "Pico simultâneo", number.format(t.peakOnline), "pessoas online ao mesmo tempo")}
    </section>

    <section class="panel">
      ${chart(days)}
      ${table(days)}
    </section>

    <div class="columns">
      <section class="panel">
        <h2>Países</h2>
        <ul>${countries}</ul>
      </section>
      <section class="panel">
        <h2>Como funciona</h2>
        <p class="about">O vídeo vai direto entre os computadores (WebRTC P2P); o servidor só faz a apresentação inicial, rodando em Cloudflare Workers e Durable Objects. As estatísticas são anônimas: nenhum nome, IP ou conteúdo é guardado.</p>
      </section>
    </div>

    <footer>
      Totais atualizados a cada 5 minutos; "online agora" a cada minuto.
      Atualizado em <span data-k="updatedAt">${new Date(stats.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span> (horário de Brasília).
      Dados brutos: <a href="/stats.json">/stats.json</a>.
    </footer>
  </main>
  <script>
    // Atualiza os números a cada minuto, só com a aba visível (não gasta requisições à toa).
    const fmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
    let last = Date.now();
    async function refresh() {
      if (document.hidden || Date.now() - last < 30000) return;
      last = Date.now();
      try {
        const s = await (await fetch("/stats.json", { cache: "no-store" })).json();
        const values = { online: s.online, last30: s.active.last30, ...s.totals };
        for (const el of document.querySelectorAll("[data-k]")) {
          const key = el.dataset.k;
          if (key === "updatedAt") el.textContent = new Date(s.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
          else if (key in values) el.textContent = fmt.format(values[key]);
        }
      } catch {}
    }
    setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  </script>
</body>
</html>`;
}
