import { test } from "node:test";
import assert from "node:assert/strict";
import { errorType, millis, parseTraces } from "../src/otlp.ts";

const s = (key: string, value: string) => ({ key, value: { stringValue: value } });
const i = (key: string, value: number) => ({ key, value: { intValue: String(value) } });
const d = (key: string, value: number) => ({ key, value: { doubleValue: value } });

// As Magnum's engine (crates/magnum-engine/src/otel.rs) sends a turn, with everything a client
// could add that this server must not keep.
const body = {
  resourceSpans: [
    {
      resource: { attributes: [s("service.name", "magnum"), s("service.version", "0.120.0"), s("magnum.workspace.id", "ws"), s("host.name", "my-mac"), s("magnum.install.id", "3f2a9c")] },
      scopeSpans: [
        {
          scope: { name: "magnum", version: "0.120.0" },
          spans: [
            {
              traceId: "0af7651916cd43dd8448eb211c80319c",
              spanId: "b7ad6b7169203331",
              name: "invoke_agent claude_code",
              kind: 3,
              startTimeUnixNano: "1764151200000000000",
              endTimeUnixNano: "1764151203500000000",
              attributes: [
                s("gen_ai.operation.name", "invoke_agent"),
                s("gen_ai.provider.name", "anthropic"),
                s("gen_ai.agent.name", "claude_code"),
                s("magnum.workspace.id", "ws"),
                s("gen_ai.conversation.id", "9f86d081884c7d65"),
                s("gen_ai.request.model", "claude-haiku-5-5"),
                s("gen_ai.response.model", "claude-haiku-5-5-20261101"),
                { key: "gen_ai.response.finish_reasons", value: { arrayValue: { values: [{ stringValue: "end_turn" }] } } },
                i("gen_ai.usage.input_tokens", 300),
                i("gen_ai.usage.output_tokens", 40),
                i("gen_ai.usage.cache_read.input_tokens", 200),
                d("magnum.cost.usd", 0.01),
                s("magnum.project", "secret-project"),
                s("magnum.role", "lead"),
                s("gen_ai.input.messages", '[{"role":"user","parts":[{"type":"text","content":"secret plans"}]}]'),
                s("gen_ai.output.messages", '[{"role":"assistant","parts":[{"type":"text","content":"done"}]}]'),
              ],
              events: [
                { timeUnixNano: "1764151200150000000", name: "magnum.ask", attributes: [s("magnum.ask.what", "Asks to use Bash")] },
                { timeUnixNano: "1764151200190000000", name: "magnum.ask.answered", attributes: [s("magnum.ask.what", "Asks to use Bash")] },
              ],
              status: {},
            },
            {
              traceId: "0af7651916cd43dd8448eb211c80319c",
              spanId: "00f067aa0ba902b7",
              parentSpanId: "b7ad6b7169203331",
              name: "execute_tool Bash",
              kind: 1,
              startTimeUnixNano: "1764151200200000000",
              endTimeUnixNano: "1764151200300000000",
              attributes: [
                s("gen_ai.operation.name", "execute_tool"),
                s("gen_ai.tool.name", "Bash"),
                s("gen_ai.tool.call.id", "t2"),
                s("gen_ai.tool.type", "function"),
                s("gen_ai.agent.name", "claude_code"),
                s("error.type", "tool_error"),
                s("gen_ai.tool.call.arguments", '{"command":"cat ~/.ssh/id_ed25519"}'),
                s("gen_ai.tool.call.result", "-----BEGIN OPENSSH PRIVATE KEY-----"),
              ],
              status: { code: 2 },
            },
            {
              traceId: "0af7651916cd43dd8448eb211c80319c",
              spanId: "1111111111111111",
              name: "invoke_workflow",
              kind: 1,
              startTimeUnixNano: "1764151200000000000",
              endTimeUnixNano: "1764151209000000000",
              attributes: [s("gen_ai.operation.name", "invoke_workflow"), s("magnum.project", "secret-project")],
              status: {},
            },
          ],
        },
      ],
    },
  ],
};

test("an invoke_agent span is one turn with only the allowed fields", () => {
  const { turns } = parseTraces(body);
  assert.deepEqual(turns, [
    {
      at: 1764151200000,
      install: "3f2a9c",
      agent: "claude_code",
      provider: "anthropic",
      model: "claude-haiku-5-5-20261101",
      duration_ms: 3500,
      input_tokens: 300,
      output_tokens: 40,
      cache_read_tokens: 200,
      cache_write_tokens: null,
      cost_usd: 0.01,
      error: null,
      asks: 1,
      version: "0.120.0",
    },
  ]);
});

test("an execute_tool span is one tool row; failed from error.type", () => {
  const { tools } = parseTraces(body);
  assert.deepEqual(tools, [{ at: 1764151200200, install: "3f2a9c", agent: "claude_code", tool: "Bash", duration_ms: 100, failed: true }]);
});

test("nothing private survives: prompts, replies, tool I/O, project, host", () => {
  const kept = JSON.stringify(parseTraces(body));
  for (const secret of ["secret plans", "done\"", "id_ed25519", "PRIVATE KEY", "secret-project", "my-mac", "9f86d081884c7d65", "Asks to use Bash", "\"ws\""]) {
    assert.ok(!kept.includes(secret), `kept ${secret}`);
  }
});

test("other spans (invoke_workflow, chat) are ignored", () => {
  const rows = parseTraces(body);
  assert.equal(rows.turns.length + rows.tools.length, 2);
});

test("operation from the span name when the attribute is missing", () => {
  const rows = parseTraces({ resourceSpans: [{ scopeSpans: [{ spans: [{ name: "invoke_agent codex", startTimeUnixNano: "2000000", endTimeUnixNano: "5000000", attributes: [s("gen_ai.request.model", "gpt-5")] }] }] }] });
  assert.equal(rows.turns[0]!.model, "gpt-5");
  assert.equal(rows.turns[0]!.install, null);
  assert.equal(rows.turns[0]!.duration_ms, 3);
});

test("bad input gives no rows, never throws", () => {
  for (const junk of [null, 1, "x", [], {}, { resourceSpans: "x" }, { resourceSpans: [{ scopeSpans: [{ spans: [null, 1, { name: "invoke_agent" }] }] }] }]) {
    assert.deepEqual(parseTraces(junk), { turns: [], tools: [] });
  }
});

test("bad numbers are dropped, labels capped", () => {
  const rows = parseTraces({
    resourceSpans: [{ resource: { attributes: [s("magnum.install.id", "x".repeat(500))] }, scopeSpans: [{ spans: [{
      startTimeUnixNano: "1000000", endTimeUnixNano: "500000",
      attributes: [s("gen_ai.operation.name", "invoke_agent"), i("gen_ai.usage.input_tokens", -5), { key: "gen_ai.usage.output_tokens", value: { intValue: "12abc" } }, d("magnum.cost.usd", Number.NaN), s("gen_ai.agent.name", "a\u0000b")],
    }] }] }],
  });
  const turn = rows.turns[0]!;
  assert.equal(turn.install!.length, 64);
  assert.equal(turn.input_tokens, null);
  assert.equal(turn.output_tokens, null);
  assert.equal(turn.cost_usd, null);
  assert.equal(turn.duration_ms, 0);
  assert.equal(turn.agent, "ab");
});

test("error.type kept only as a token", () => {
  assert.equal(errorType("error_max_turns"), "error_max_turns");
  assert.equal(errorType(529), "529");
  assert.equal(errorType("API Error: the file /Users/me/secret.txt was not found"), "other");
  assert.equal(errorType(undefined), null);
});

test("nanosecond strings to milliseconds without losing precision", () => {
  assert.equal(millis("1764151200123456789"), 1764151200123);
  assert.equal(millis("nope"), null);
});
