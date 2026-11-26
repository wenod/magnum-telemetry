// The owner's pages: plain HTML and CSS, light and dark, no scripts. Every value shown came from
// an anonymous client, so all of it is escaped.

export interface Breakdown {
  name: string | null;
  turns: number;
  tokens: number | null;
  cost: number | null;
  errors: number | null;
}

export interface Period {
  days: 7 | 30 | 90;
  now: number;
  summary: { turns?: number; installs?: number; input?: number | null; output?: number | null; cache_read?: number | null; cache_write?: number | null; cost?: number | null; errors?: number | null };
  perDay: { day: string; turns: number; installs: number }[];
  agents: Breakdown[];
  providers: Breakdown[];
  models: Breakdown[];
  tools: { name: string | null; calls: number; failed: number | null; avg_ms: number | null }[];
  toolTotals: { calls?: number; failed?: number | null };
}

export function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const number = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function n(value: number | null | undefined): string {
  return number.format(value ?? 0);
}

function short(value: number | null | undefined): string {
  return compact.format(value ?? 0);
}

function usd(value: number | null | undefined): string {
  const v = value ?? 0;
  return `$${v >= 100 ? number.format(Math.round(v)) : v.toFixed(2)}`;
}

function percent(part: number | null | undefined, whole: number | null | undefined): string {
  if (!whole) return "—";
  const p = ((part ?? 0) / whole) * 100;
  if (p === 0) return "0%";
  return `${p > 0 && p < 0.1 ? "<0.1" : p.toFixed(p >= 10 ? 0 : 1)}%`;
}

function duration(ms: number | null | undefined): string {
  const v = ms ?? 0;
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
}

function name(value: string | null): string {
  return value ? escape(value) : `<span class="quiet">unknown</span>`;
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #f7f7f5; --panel: #ffffff; --text: #1b1b1a; --quiet: #6b6b66; --line: #e4e4e0;
  --accent: #3f62d6; --on-accent: #ffffff; --accent-soft: #dfe6fb; --bad: #c2412d; --focus: #3f62d6;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;
  --radius: 8px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #141413; --panel: #1d1d1b; --text: #ecece8; --quiet: #9a9a94; --line: #2e2e2b; --accent: #7d9bff; --on-accent: #0d1530; --accent-soft: #26304d; --bad: #f07a63; --focus: #7d9bff; }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/20px system-ui, -apple-system, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums; }
main { max-width: 1120px; margin: 0 auto; padding: var(--s6) var(--s4) var(--s7); }
h1 { font-size: 18px; line-height: 24px; font-weight: 600; margin: 0; }
h2 { font-size: 13px; line-height: 20px; font-weight: 600; margin: 0 0 var(--s3); color: var(--quiet); }
.quiet { color: var(--quiet); }
header { display: flex; align-items: center; gap: var(--s4); flex-wrap: wrap; margin-bottom: var(--s5); }
header .spacer { flex: 1; }
nav.periods { display: inline-flex; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); padding: 2px; }
nav.periods a { padding: var(--s1) var(--s3); border-radius: 6px; color: var(--quiet); text-decoration: none; }
nav.periods a:hover { color: var(--text); }
nav.periods a[aria-current="page"] { background: var(--accent-soft); color: var(--text); font-weight: 600; }
a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
button { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--s1) var(--s3); cursor: pointer; }
button:hover { border-color: var(--quiet); }
button:active { background: var(--line); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; padding: var(--s2) var(--s4); }
button.primary:hover { filter: brightness(1.08); }
form.inline { margin: 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--s3); margin-bottom: var(--s5); }
.tile, .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); }
.tile { padding: var(--s4); }
.tile .label { color: var(--quiet); font-size: 12px; line-height: 16px; }
.tile .value { font-size: 24px; line-height: 32px; font-weight: 600; margin-top: var(--s1); }
.tile .sub { color: var(--quiet); font-size: 12px; line-height: 16px; margin-top: var(--s1); }
.card { padding: var(--s4); margin-bottom: var(--s5); overflow-x: auto; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: var(--s5); }
.grid .card { margin-bottom: 0; }
.grid + .card, .grid + .grid { margin-top: var(--s5); }
.chart { display: flex; align-items: flex-end; gap: 2px; height: 120px; }
.chart .bar { flex: 1; min-width: 2px; background: var(--accent); border-radius: 2px 2px 0 0; min-height: 1px; }
.chart .bar.zero { background: var(--line); }
.chart .bar:hover { filter: brightness(1.15); }
.axis { display: flex; justify-content: space-between; color: var(--quiet); font-size: 12px; line-height: 16px; margin-top: var(--s2); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: right; padding: var(--s1) 0 var(--s1) var(--s3); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; padding-left: 0; white-space: normal; overflow-wrap: break-word; min-width: 96px; }
th { color: var(--quiet); font-weight: 500; font-size: 12px; border-bottom: 1px solid var(--line); padding-bottom: var(--s2); }
tbody tr:first-child td { padding-top: var(--s2); }
td.bad { color: var(--bad); }
@media (max-width: 480px) { .share { display: none; } }
.empty { color: var(--quiet); padding: var(--s5) 0; text-align: center; }
.login { max-width: 360px; margin: 18vh auto 0; }
.login .card { padding: var(--s5); }
.login label { display: block; font-weight: 500; margin-bottom: var(--s2); }
.login input { width: 100%; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--s2) var(--s3); margin-bottom: var(--s4); }
.login .error { color: var(--bad); margin: 0 0 var(--s4); }
.login h1 { margin-bottom: var(--s5); }
`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

export function login(error?: string): string {
  return shell(
    "Magnum Telemetry",
    `<main class="login"><h1>Magnum Telemetry</h1><form class="card" method="post" action="/login">${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}<label for="key">Owner key</label><input id="key" name="key" type="password" autocomplete="current-password" required autofocus><button class="primary" type="submit">Sign In</button></form></main>`,
  );
}

function breakdown(title: string, column: string, rows: Breakdown[], total: number): string {
  if (!rows.length) return `<section class="card"><h2>${title}</h2><p class="empty">No turns</p></section>`;
  const body = rows
    .map((row) => `<tr><td>${name(row.name)}</td><td>${n(row.turns)}</td><td class="quiet share">${percent(row.turns, total)}</td><td>${short(row.tokens)}</td><td>${usd(row.cost)}</td><td${row.errors ? ' class="bad"' : ""}>${percent(row.errors, row.turns)}</td></tr>`)
    .join("");
  return `<section class="card"><h2>${title}</h2><table><thead><tr><th>${column}</th><th>Turns</th><th class="share">Share</th><th>Tokens</th><th>Cost</th><th>Errors</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

function days(period: Period): { day: string; turns: number; installs: number }[] {
  const byDay = new Map(period.perDay.map((row) => [row.day, row]));
  const out = [];
  for (let i = period.days - 1; i >= 0; i--) {
    const day = new Date(period.now - i * 86_400_000).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, turns: 0, installs: 0 });
  }
  return out;
}

function chart(period: Period): string {
  const all = days(period);
  const max = Math.max(1, ...all.map((d) => d.turns));
  const bars = all
    .map((d) => `<div class="bar${d.turns ? "" : " zero"}" style="height:${d.turns ? Math.max(2, (d.turns / max) * 100).toFixed(1) : 0}%" title="${d.day}: ${n(d.turns)} turns, ${n(d.installs)} installs"></div>`)
    .join("");
  return `<section class="card"><h2>Turns per day</h2><div class="chart" role="img" aria-label="Turns per day, most ${n(max)}">${bars}</div><div class="axis"><span>${all[0]!.day}</span><span>Most ${n(max)} a day</span><span>${all[all.length - 1]!.day}</span></div></section>`;
}

function tools(period: Period): string {
  if (!period.tools.length) return `<section class="card"><h2>Top tools</h2><p class="empty">No tool calls</p></section>`;
  const body = period.tools
    .map((t) => `<tr><td>${name(t.name)}</td><td>${n(t.calls)}</td><td${t.failed ? ' class="bad"' : ""}>${percent(t.failed, t.calls)}</td><td>${duration(t.avg_ms)}</td></tr>`)
    .join("");
  return `<section class="card"><h2>Top tools</h2><table><thead><tr><th>Tool</th><th>Calls</th><th>Failed</th><th>Average</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

export function dashboard(period: Period): string {
  const s = period.summary;
  const turns = s.turns ?? 0;
  const tokens = (s.input ?? 0) + (s.output ?? 0) + (s.cache_read ?? 0) + (s.cache_write ?? 0);
  const periods = ([7, 30, 90] as const).map((d) => `<a href="/?days=${d}"${d === period.days ? ' aria-current="page"' : ""}>${d} days</a>`).join("");
  const tile = (label: string, value: string, sub = "") => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const header = `<header><h1>Magnum Telemetry</h1><nav class="periods" aria-label="Period">${periods}</nav><span class="spacer"></span><form class="inline" method="post" action="/logout"><button type="submit">Sign Out</button></form></header>`;
  if (!turns && !period.tools.length) {
    return shell("Magnum Telemetry", `<main>${header}<section class="card"><p class="empty">No turns in the last ${period.days} days</p></section></main>`);
  }
  const tiles = `<div class="tiles">${[
    tile("Installs", n(s.installs)),
    tile("Turns", n(turns)),
    tile("Tokens", short(tokens), `${short(s.input)} in · ${short(s.output)} out · ${short((s.cache_read ?? 0) + (s.cache_write ?? 0))} cache`),
    tile("Cost", usd(s.cost)),
    tile("Error rate", percent(s.errors, turns), `Tools ${percent(period.toolTotals.failed, period.toolTotals.calls)} failed`),
  ].join("")}</div>`;
  return shell(
    "Magnum Telemetry",
    `<main>${header}${tiles}${chart(period)}<div class="grid">${breakdown("By agent", "Agent", period.agents, turns)}${breakdown("By provider", "Provider", period.providers, turns)}</div><div class="grid">${breakdown("By model", "Model", period.models, turns)}${tools(period)}</div></main>`,
  );
}
