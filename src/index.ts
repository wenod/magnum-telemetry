// Magnum's telemetry server: takes Magnum's OpenTelemetry (OTLP/HTTP JSON), keeps a few numbers
// per agent turn and tool call in D1, and shows them to the owner. See README.md.

import { parseTraces, type Rows } from "./otlp.ts";
import { dashboard, login, type Period } from "./dashboard.ts";

export interface Env {
  DB: D1Database;
  /** Writes per install id (anonymous writes only). */
  LIMIT_INSTALL: RateLimit;
  /** Writes and sign-in attempts per IP address. */
  LIMIT_IP: RateLimit;
  /** When set, writes need `Authorization: Bearer <WRITE_KEY>`. */
  WRITE_KEY?: string;
  /** The dashboard's key. */
  OWNER_KEY?: string;
  RETENTION_DAYS?: string;
}

/** The largest request body taken (after gzip, if any). */
const MAX_BODY = 1024 * 1024;
const DAY = 86_400_000;
const COOKIE = "owner";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case "/v1/traces":
          return await traces(request, env);
        case "/v1/metrics":
          return await metrics(request, env);
        case "/":
          return await home(request, env, url);
        case "/login":
          return await signIn(request, env);
        case "/logout":
          return request.method === "POST" ? redirect("/", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`) : text(405, "Method Not Allowed");
        default:
          return text(404, "Not Found");
      }
    } catch (error) {
      console.error(error);
      return text(500, "Internal Server Error");
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const before = Date.now() - retention(env) * DAY;
    await env.DB.batch([env.DB.prepare("DELETE FROM turns WHERE at < ?").bind(before), env.DB.prepare("DELETE FROM tools WHERE at < ?").bind(before)]);
  },
} satisfies ExportedHandler<Env>;

function retention(env: Env): number {
  const days = Number(env.RETENTION_DAYS);
  return Number.isFinite(days) && days >= 1 ? Math.floor(days) : 90;
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
}

function otlpOk(): Response {
  // An ExportTraceServiceResponse / ExportMetricsServiceResponse with nothing rejected.
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function ip(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

/** `a === b`, in time that doesn't depend on where they differ. */
async function same(a: string, b: string): Promise<boolean> {
  return crypto.subtle.timingSafeEqual(await sha256(a), await sha256(b));
}

// Writes ------------------------------------------------------------------------------------

/** Whether a write may go on; else the answer to give. */
async function writable(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== "POST") return text(405, "Method Not Allowed", { Allow: "POST" });
  if (env.WRITE_KEY) {
    const given = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
    if (!(await same(given, env.WRITE_KEY))) return text(401, "Unauthorized", { "WWW-Authenticate": "Bearer" });
  } else if (!(await env.LIMIT_IP.limit({ key: `write:${ip(request)}` })).success) {
    return text(429, "Too Many Requests", { "Retry-After": "60" });
  }
  const type = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json\b/i.test(type)) return text(415, "OTLP/HTTP JSON only (Content-Type: application/json)");
  return null;
}

/** The body as text, read up to [`MAX_BODY`]; null when it's larger. */
async function body(request: Request): Promise<string | null | Response> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY) return null;
  let stream = request.body;
  if (!stream) return "";
  const encoding = (request.headers.get("Content-Encoding") ?? "identity").toLowerCase();
  if (encoding === "gzip") stream = stream.pipeThrough(new DecompressionStream("gzip"));
  else if (encoding !== "identity") return text(415, "Content-Encoding: gzip or none");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

async function traces(request: Request, env: Env): Promise<Response> {
  const refused = await writable(request, env);
  if (refused) return refused;
  const read = await body(request).catch(() => text(400, "Bad body"));
  if (read instanceof Response) return read;
  if (read === null) return text(413, "Payload Too Large");
  let json: unknown;
  try {
    json = JSON.parse(read);
  } catch {
    return text(400, "Not JSON");
  }
  const rows = parseTraces(json);
  if (!env.WRITE_KEY) {
    // Anonymous writes: limited per install (each install sends its own id).
    const installs = new Set([...rows.turns, ...rows.tools].map((row) => row.install ?? `ip:${ip(request)}`));
    if (installs.size > 4) return text(400, "One install a request");
    for (const install of installs) {
      if (!(await env.LIMIT_INSTALL.limit({ key: install })).success) return text(429, "Too Many Requests", { "Retry-After": "60" });
    }
  }
  await store(env, rows);
  return otlpOk();
}

async function metrics(request: Request, env: Env): Promise<Response> {
  // Taken and dropped: the dashboard is built from traces.
  const refused = await writable(request, env);
  return refused ?? otlpOk();
}

/** Keeps `rows` dated within the retention window (a day ahead at most). */
async function store(env: Env, rows: Rows): Promise<void> {
  const now = Date.now();
  const recent = <T extends { at: number }>(row: T) => row.at >= now - retention(env) * DAY && row.at <= now + DAY;
  const turns = rows.turns.filter(recent);
  const tools = rows.tools.filter(recent).map((tool) => ({ ...tool, failed: tool.failed ? 1 : 0 }));
  const statements: D1PreparedStatement[] = [];
  // One statement a table, the rows as one JSON parameter (D1 caps bound parameters at 100).
  if (turns.length) {
    const columns = ["at", "install", "agent", "provider", "model", "duration_ms", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd", "error", "asks", "version"];
    statements.push(insert(env, "turns", columns, turns));
  }
  if (tools.length) statements.push(insert(env, "tools", ["at", "install", "agent", "tool", "duration_ms", "failed"], tools));
  if (statements.length) await env.DB.batch(statements);
}

function insert(env: Env, table: string, columns: string[], rows: object[]): D1PreparedStatement {
  const values = columns.map((column) => `json_extract(value, '$.${column}')`).join(", ");
  return env.DB.prepare(`INSERT INTO ${table} (${columns.join(", ")}) SELECT ${values} FROM json_each(?)`).bind(JSON.stringify(rows));
}

// The owner's dashboard ------------------------------------------------------------------------

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function page(status: number, html: string, extra: Record<string, string> = {}): Response {
  return new Response(html, { status, headers: { ...PAGE_HEADERS, ...extra } });
}

/** The cookie's value: proof of the key without being it. */
async function session(env: Env): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.OWNER_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("magnum-telemetry-owner"));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signedIn(request: Request, env: Env): Promise<boolean> {
  const cookie = (request.headers.get("Cookie") ?? "").split(/;\s*/).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return !!cookie && (await same(cookie, await session(env)));
}

async function signIn(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return redirect("/");
  if (!env.OWNER_KEY) return page(503, login("This server has no OWNER_KEY set."));
  if (!(await env.LIMIT_IP.limit({ key: `login:${ip(request)}` })).success) return page(429, login("Too many tries. Wait a minute."), { "Retry-After": "60" });
  const form = await request.formData().catch(() => null);
  const key = form?.get("key");
  if (typeof key !== "string" || !(await same(key, env.OWNER_KEY))) return page(401, login("That key isn't right."));
  return redirect("/", `${COOKIE}=${await session(env)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 86400}`);
}

async function home(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Method Not Allowed");
  if (!env.OWNER_KEY) return page(503, login("This server has no OWNER_KEY set."));
  if (!(await signedIn(request, env))) return page(200, login());
  const asked = Number(url.searchParams.get("days"));
  const days = ([7, 30, 90] as const).find((d) => d === asked) ?? 7;
  return page(200, dashboard(await period(env, days)));
}

async function period(env: Env, days: 7 | 30 | 90): Promise<Period> {
  const now = Date.now();
  const since = now - days * DAY;
  const by = (column: string) =>
    env.DB.prepare(
      `SELECT ${column} AS name, COUNT(*) AS turns, SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0) + COALESCE(cache_read_tokens,0) + COALESCE(cache_write_tokens,0)) AS tokens, SUM(cost_usd) AS cost, SUM(error IS NOT NULL) AS errors FROM turns WHERE at >= ?1 GROUP BY ${column} ORDER BY turns DESC LIMIT 15`,
    ).bind(since);
  const [summary, perDay, agents, providers, models, tools, toolTotals] = await env.DB.batch([
    env.DB.prepare(
      "SELECT COUNT(*) AS turns, COUNT(DISTINCT install) AS installs, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cache_read_tokens) AS cache_read, SUM(cache_write_tokens) AS cache_write, SUM(cost_usd) AS cost, SUM(error IS NOT NULL) AS errors FROM turns WHERE at >= ?1",
    ).bind(since),
    env.DB.prepare("SELECT date(at / 1000, 'unixepoch') AS day, COUNT(*) AS turns, COUNT(DISTINCT install) AS installs FROM turns WHERE at >= ?1 GROUP BY day ORDER BY day").bind(since),
    by("agent"),
    by("provider"),
    by("model"),
    env.DB.prepare("SELECT tool AS name, COUNT(*) AS calls, SUM(failed) AS failed, AVG(duration_ms) AS avg_ms FROM tools WHERE at >= ?1 GROUP BY tool ORDER BY calls DESC LIMIT 20").bind(since),
    env.DB.prepare("SELECT COUNT(*) AS calls, SUM(failed) AS failed FROM tools WHERE at >= ?1").bind(since),
  ]);
  const first = <T>(result: D1Result) => (result.results[0] ?? {}) as T;
  return {
    days,
    now,
    summary: first(summary),
    perDay: perDay.results as Period["perDay"],
    agents: agents.results as Period["agents"],
    providers: providers.results as Period["providers"],
    models: models.results as Period["models"],
    tools: tools.results as Period["tools"],
    toolTotals: first(toolTotals),
  };
}
