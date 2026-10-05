import type { PageLanguage } from "./index";
import type { StatsDay, StatsSummary } from "./stats";

const CHART_DAYS = 30;

const TEXT = {
  en: {
    title: "Janshare in numbers",
    description: "Public, anonymous usage statistics for Janshare, lightweight peer-to-peer screen sharing.",
    tagline: "Lightweight peer-to-peer screen sharing for Windows. Free, no sign-up.",
    online: "online now",
    totals: "Totals",
    users: "Users",
    usersHint: "unique installs",
    active30: "Active in 30 days",
    activeToday: "{n} today",
    streams: "Streams",
    streamHours: "Hours streamed",
    watchHours: "Hours watched",
    watchHint: "across all viewers",
    rooms: "Rooms created",
    sessions: "Sessions",
    sessionsHint: "{n} h in rooms",
    peak: "Peak concurrent",
    peakHint: "people online at once",
    chart: "Daily active users",
    chartSpan: "(last {n} days)",
    user: "user",
    usersWord: "users",
    streamsShort: "streams",
    table: "Show data as a table",
    day: "Day",
    activeCol: "Active",
    newCol: "New",
    streamsCol: "Streams",
    streamHoursCol: "Hours streamed",
    watchHoursCol: "Hours watched",
    peakCol: "Peak online",
    countries: "Countries",
    others: "Others",
    empty: "No data yet.",
    howTitle: "How it works",
    how: "Video goes straight between computers (WebRTC P2P); the server only handles the initial handshake, running on Cloudflare Workers and Durable Objects. Statistics are anonymous: no names, IPs or content are stored.",
    footerRefresh: 'Totals refresh every 5 minutes; "online now" every minute.',
    updated: "Updated",
    zone: "(UTC)",
    raw: "Raw data:"
  },
  pt: {
    title: "Janshare em números",
    description: "Estatísticas públicas e anônimas de uso do Janshare, compartilhamento de tela P2P leve.",
    tagline: "Compartilhamento de tela P2P leve para Windows. Gratuito e sem cadastro.",
    online: "online agora",
    totals: "Totais",
    users: "Usuários",
    usersHint: "instalações únicas",
    active30: "Ativos em 30 dias",
    activeToday: "{n} hoje",
    streams: "Transmissões",
    streamHours: "Horas transmitidas",
    watchHours: "Horas assistidas",
    watchHint: "somando todos os espectadores",
    rooms: "Salas criadas",
    sessions: "Sessões",
    sessionsHint: "{n} h em salas",
    peak: "Pico simultâneo",
    peakHint: "pessoas online ao mesmo tempo",
    chart: "Usuários ativos por dia",
    chartSpan: "(últimos {n} dias)",
    user: "usuário",
    usersWord: "usuários",
    streamsShort: "transm.",
    table: "Ver dados em tabela",
    day: "Dia",
    activeCol: "Ativos",
    newCol: "Novos",
    streamsCol: "Transmissões",
    streamHoursCol: "Horas transm.",
    watchHoursCol: "Horas assistidas",
    peakCol: "Pico online",
    countries: "Países",
    others: "Outros",
    empty: "Ainda sem dados.",
    howTitle: "Como funciona",
    how: "O vídeo vai direto entre os computadores (WebRTC P2P); o servidor só faz a apresentação inicial, rodando em Cloudflare Workers e Durable Objects. As estatísticas são anônimas: nenhum nome, IP ou conteúdo é guardado.",
    footerRefresh: 'Totais atualizados a cada 5 minutos; "online agora" a cada minuto.',
    updated: "Atualizado em",
    zone: "(horário de Brasília)",
    raw: "Dados brutos:"
  }
} satisfies Record<PageLanguage, Record<string, string>>;

const LOCALE: Record<PageLanguage, { tag: string; timeZone: string }> = {
  en: { tag: "en-US", timeZone: "UTC" },
  pt: { tag: "pt-BR", timeZone: "America/Sao_Paulo" }
};

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

export function statsPage(stats: StatsSummary, icon: string, language: PageLanguage): string {
  const text = TEXT[language];
  const { tag, timeZone } = LOCALE[language];
  const number = new Intl.NumberFormat(tag);
  const decimal = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const fill = (template: string, n: string | number) => template.replace("{n}", String(n));
  // "04/10" em português, "Oct 4" em inglês.
  const dateFormat = new Intl.DateTimeFormat(tag, language === "pt" ? { day: "2-digit", month: "2-digit", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
  const shortDate = (day: string) => dateFormat.format(new Date(`${day}T00:00:00Z`));
  const usersLabel = (n: number) => `${number.format(n)} ${n === 1 ? text.user : text.usersWord}`;

  // Nome do país no idioma da página (bandeiras em emoji não aparecem no Windows).
  const countryName = (country: string) => {
    if (!/^[A-Z]{2}$/.test(country) || country === "XX") return text.others;
    try {
      return new Intl.DisplayNames([tag], { type: "region" }).of(country) ?? country;
    } catch {
      return country;
    }
  };

  const tile = (key: string, label: string, value: string, hint = "") =>
    `<div class="tile"><span class="tile-label">${label}</span><strong data-k="${key}">${value}</strong>${
      hint ? `<span class="tile-hint">${hint}</span>` : ""
    }</div>`;

  const days = lastDays(stats.days, CHART_DAYS);
  const max = Math.max(1, ...days.map(d => d.users));
  const bars = days
    .map(d => {
      const height = (d.users / max) * 100;
      return `<div class="bar-slot" tabindex="0" aria-label="${shortDate(d.day)}: ${usersLabel(d.users)}">
        <div class="bar" style="height:${height.toFixed(2)}%"></div>
        <div class="tip"><strong>${number.format(d.users)}</strong> ${d.users === 1 ? text.user : text.usersWord}<br><span>${shortDate(
          d.day
        )} · ${number.format(d.streams)} ${text.streamsShort} · ${decimal.format(d.streamHours)} h</span></div>
      </div>`;
    })
    .join("");

  const rows = [...days]
    .reverse()
    .map(
      d => `<tr><td>${shortDate(d.day)}</td><td>${number.format(d.users)}</td><td>${number.format(d.newUsers)}</td><td>${number.format(
        d.streams
      )}</td><td>${decimal.format(d.streamHours)}</td><td>${decimal.format(d.watchHours)}</td><td>${number.format(d.peak)}</td></tr>`
    )
    .join("");

  const t = stats.totals;
  const countries = stats.countries.length
    ? stats.countries.map(c => `<li><span>${countryName(c.country)}</span><span>${number.format(c.users)}</span></li>`).join("")
    : `<li class="empty">${text.empty}</li>`;
  const formatUpdated = (iso: string) => new Date(iso).toLocaleString(tag, { timeZone });

  return `<!doctype html>
<html lang="${tag}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${text.title}</title>
  <meta name="description" content="${text.description}" />
  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}" />
  <style>
    :root { color-scheme: dark; --bg: #313338; --surface: #2b2d31; --ink: #f2f3f5; --ink-2: #b5bac1; --muted: #80848e; --line: #3f4147; --bar: #6f7af5; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink-2); font-family: "Noto Sans", "Segoe UI", system-ui, sans-serif; }
    main { max-width: 960px; margin: 0 auto; padding: 40px 20px 56px; }
    header { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-bottom: 28px; }
    header img { width: 48px; height: 48px; }
    h1 { color: var(--ink); font-size: 26px; margin: 0; }
    header p { margin: 4px 0 0; font-size: 14px; }
    .online { display: inline-flex; align-items: center; gap: 8px; background: var(--surface); padding: 8px 14px; border-radius: 999px; margin-left: auto; font-size: 14px; white-space: nowrap; }
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
        <h1>${text.title}</h1>
        <p>${text.tagline}</p>
      </div>
      <div class="online"><span class="dot" aria-hidden="true"></span><strong data-k="online">${number.format(stats.online)}</strong> ${text.online}</div>
    </header>

    <section class="tiles" aria-label="${text.totals}">
      ${tile("users", text.users, number.format(t.users), text.usersHint)}
      ${tile("last30", text.active30, number.format(stats.active.last30), fill(text.activeToday, number.format(stats.active.today)))}
      ${tile("streams", text.streams, number.format(t.streams))}
      ${tile("streamHours", text.streamHours, decimal.format(t.streamHours))}
      ${tile("watchHours", text.watchHours, decimal.format(t.watchHours), text.watchHint)}
      ${tile("rooms", text.rooms, number.format(t.rooms))}
      ${tile("sessions", text.sessions, number.format(t.sessions), fill(text.sessionsHint, decimal.format(t.sessionHours)))}
      ${tile("peakOnline", text.peak, number.format(t.peakOnline), text.peakHint)}
    </section>

    <section class="panel">
      <figure class="chart">
        <figcaption>${text.chart} <span>${fill(text.chartSpan, CHART_DAYS)}</span></figcaption>
        <div class="plot">
          <div class="y-max">${number.format(max)}</div>
          <div class="grid"></div>
          <div class="bars">${bars}</div>
        </div>
        <div class="x-axis"><span>${shortDate(days[0].day)}</span><span>${shortDate(days[days.length - 1].day)}</span></div>
      </figure>
      <details class="table-view"><summary>${text.table}</summary>
        <div class="table-wrap"><table>
          <thead><tr><th>${text.day}</th><th>${text.activeCol}</th><th>${text.newCol}</th><th>${text.streamsCol}</th><th>${text.streamHoursCol}</th><th>${text.watchHoursCol}</th><th>${text.peakCol}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </details>
    </section>

    <div class="columns">
      <section class="panel">
        <h2>${text.countries}</h2>
        <ul>${countries}</ul>
      </section>
      <section class="panel">
        <h2>${text.howTitle}</h2>
        <p class="about">${text.how}</p>
      </section>
    </div>

    <footer>
      ${text.footerRefresh}
      ${text.updated} <span data-k="updatedAt">${formatUpdated(stats.updatedAt)}</span> ${text.zone}.
      ${text.raw} <a href="/stats.json">/stats.json</a>.
    </footer>
  </main>
  <script>
    // Atualiza os números a cada minuto, só com a aba visível (não gasta requisições à toa).
    const fmt = new Intl.NumberFormat(${JSON.stringify(tag)}, { maximumFractionDigits: 1 });
    let last = Date.now();
    async function refresh() {
      if (document.hidden || Date.now() - last < 30000) return;
      last = Date.now();
      try {
        const s = await (await fetch("/stats.json", { cache: "no-store" })).json();
        const values = { online: s.online, last30: s.active.last30, ...s.totals };
        for (const el of document.querySelectorAll("[data-k]")) {
          const key = el.dataset.k;
          if (key === "updatedAt") el.textContent = new Date(s.updatedAt).toLocaleString(${JSON.stringify(tag)}, { timeZone: ${JSON.stringify(timeZone)} });
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
