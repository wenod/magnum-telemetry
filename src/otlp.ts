// OTLP/HTTP JSON → the rows this server keeps. Only the attributes named here are read; every
// other one (prompts, replies, tool input/output, project and host names…) is never looked at,
// so it can't be stored even when a client sends it.
//
// Names as of open-telemetry/semantic-conventions-genai@81b5d438519f868a186bff088d9de24aefdb2f6b.

export const SPEC = "open-telemetry/semantic-conventions-genai@81b5d438519f868a186bff088d9de24aefdb2f6b";

/** One `invoke_agent` span: an agent's turn. */
export interface Turn {
  at: number; // start, ms since the epoch
  install: string | null;
  agent: string | null;
  provider: string | null;
  model: string | null;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
  error: string | null;
  asks: number;
  version: string | null;
}

/** One `execute_tool` span: a tool an agent used. */
export interface Tool {
  at: number;
  install: string | null;
  agent: string | null;
  tool: string | null;
  duration_ms: number;
  failed: boolean;
}

export interface Rows {
  turns: Turn[];
  tools: Tool[];
}

/** The most spans read from one request. */
export const MAX_SPANS = 2000;

type Json = unknown;

function object(value: Json): Record<string, Json> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Json>) : null;
}

function array(value: Json): Json[] {
  return Array.isArray(value) ? value : [];
}

/** An attribute list's values for `wanted` keys only (scalars; arrays and maps are skipped). */
function attributes(list: Json, wanted: readonly string[]): Map<string, string | number | boolean> {
  const found = new Map<string, string | number | boolean>();
  for (const item of array(list)) {
    const attribute = object(item);
    const key = attribute?.key;
    if (typeof key !== "string" || !wanted.includes(key) || found.has(key)) continue;
    const value = scalar(attribute?.value);
    if (value !== null) found.set(key, value);
  }
  return found;
}

function scalar(any: Json): string | number | boolean | null {
  const value = object(any);
  if (!value) return null;
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.boolValue === "boolean") return value.boolValue;
  if (typeof value.intValue === "string" && /^-?\d+$/.test(value.intValue)) return Number(value.intValue);
  if (typeof value.intValue === "number" && Number.isFinite(value.intValue)) return Math.trunc(value.intValue);
  if (typeof value.doubleValue === "number" && Number.isFinite(value.doubleValue)) return value.doubleValue;
  if (typeof value.doubleValue === "string" && Number.isFinite(Number(value.doubleValue))) return Number(value.doubleValue);
  return null;
}

/** A short label: trimmed, control characters dropped, at most `max` characters. */
export function label(value: string | number | boolean | undefined, max = 100): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return clean || null;
}

/** `error.type` kept only as a short token (`error_max_turns`, `529`, `tool_error`); free text,
 * which could quote what an agent was doing, becomes `other`. */
export function errorType(value: string | number | boolean | undefined): string | null {
  if (typeof value === "number") value = String(value);
  if (typeof value !== "string" || !value.trim()) return null;
  const token = value.trim();
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(token) ? token : "other";
}

function count(value: string | number | boolean | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER);
}

function money(value: string | number | boolean | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e6) return null;
  return value;
}

/** Nanoseconds since the epoch (a decimal string, or a number) → milliseconds. */
export function millis(value: Json): number | null {
  if (typeof value === "string" && /^\d{1,25}$/.test(value)) return Number(BigInt(value) / 1_000_000n);
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value / 1e6);
  return null;
}

const RESOURCE = ["magnum.install.id", "service.version"] as const;
const SPAN = [
  "gen_ai.operation.name",
  "gen_ai.agent.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  "gen_ai.usage.cache_read.input_tokens",
  "gen_ai.usage.cache_write.input_tokens",
  "magnum.cost.usd",
  "error.type",
  "gen_ai.tool.name",
] as const;

function operation(span: Record<string, Json>, found: Map<string, string | number | boolean>): string | null {
  const named = found.get("gen_ai.operation.name");
  if (typeof named === "string") return named;
  const name = typeof span.name === "string" ? span.name : "";
  return name.split(" ")[0] || null;
}

/** The turns and tools in an OTLP/JSON `ExportTraceServiceRequest`. */
export function parseTraces(body: Json): Rows {
  const rows: Rows = { turns: [], tools: [] };
  let seen = 0;
  for (const resourceSpans of array(object(body)?.resourceSpans)) {
    const resource = attributes(object(object(resourceSpans)?.resource)?.attributes, RESOURCE);
    const install = label(resource.get("magnum.install.id"), 64);
    const version = label(resource.get("service.version"), 32);
    for (const scopeSpans of array(object(resourceSpans)?.scopeSpans)) {
      for (const item of array(object(scopeSpans)?.spans)) {
        if (++seen > MAX_SPANS) return rows;
        const span = object(item);
        if (!span) continue;
        const start = millis(span.startTimeUnixNano);
        const end = millis(span.endTimeUnixNano);
        if (start === null) continue;
        const duration_ms = end !== null && end >= start ? end - start : 0;
        const found = attributes(span.attributes, SPAN);
        const op = operation(span, found);
        if (op === "invoke_agent") {
          const asks = array(span.events).filter((event) => object(event)?.name === "magnum.ask").length;
          rows.turns.push({
            at: start,
            install,
            agent: label(found.get("gen_ai.agent.name"), 64),
            provider: label(found.get("gen_ai.provider.name"), 64),
            model: label(found.get("gen_ai.response.model")) ?? label(found.get("gen_ai.request.model")),
            duration_ms,
            input_tokens: count(found.get("gen_ai.usage.input_tokens")),
            output_tokens: count(found.get("gen_ai.usage.output_tokens")),
            cache_read_tokens: count(found.get("gen_ai.usage.cache_read.input_tokens")),
            cache_write_tokens: count(found.get("gen_ai.usage.cache_write.input_tokens")),
            cost_usd: money(found.get("magnum.cost.usd")),
            error: errorType(found.get("error.type")),
            asks,
            version,
          });
        } else if (op === "execute_tool") {
          rows.tools.push({
            at: start,
            install,
            agent: label(found.get("gen_ai.agent.name"), 64),
            tool: label(found.get("gen_ai.tool.name")),
            duration_ms,
            failed: found.has("error.type"),
          });
        }
      }
    }
  }
  return rows;
}
