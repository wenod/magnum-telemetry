# Magnum Telemetry

The server behind [Magnum](https://magnumade.com)'s optional telemetry: a Cloudflare Worker that takes OpenTelemetry traces (OTLP/HTTP JSON), keeps a few numbers per agent turn and tool call in D1, and shows them on a small dashboard for its owner.

Magnum's own runs at `https://telemetry.magnumade.com`. Run your own to see your team's agents without sending anything to Prayukta.

## What it stores

It reads the [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai) as of `open-telemetry/semantic-conventions-genai@81b5d438519f868a186bff088d9de24aefdb2f6b`.

One row per `invoke_agent` span (an agent's turn), table `turns`:

| Column | From |
| --- | --- |
| `at` | the span's start (ms) |
| `install` | resource `magnum.install.id` (a random id made once per computer) |
| `agent` | `gen_ai.agent.name` |
| `provider` | `gen_ai.provider.name` |
| `model` | `gen_ai.response.model`, else `gen_ai.request.model` |
| `duration_ms` | the span's end − start |
| `input_tokens`, `output_tokens` | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` |
| `cache_read_tokens`, `cache_write_tokens` | `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_write.input_tokens` |
| `cost_usd` | `magnum.cost.usd` |
| `error` | `error.type`, only as a short token (`error_max_turns`, `529`); free text becomes `other` |
| `asks` | how many `magnum.ask` events (the agent asked the person) |
| `version` | resource `service.version` (Magnum's version) |

One row per `execute_tool` span (a tool call), table `tools`: `at`, `install`, `agent`, `tool` (`gen_ai.tool.name`), `duration_ms`, `failed` (`error.type` was set).

## What it never stores

Only the attributes above are read; everything else in a request is dropped before anything is written, even when a client sends it:

- prompts and replies (`gen_ai.input.messages`, `gen_ai.output.messages`, system instructions);
- tool input and output (`gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`);
- project, workspace, host and user names (`magnum.project`, `magnum.workspace.id`, `host.name`, …);
- conversation, trace and span ids, ask texts, IP addresses.

Metrics (`POST /v1/metrics`) are answered `200` and dropped: the dashboard is built from traces. Rows older than `RETENTION_DAYS` (90) are deleted daily.

When Magnum sends to Magnum's own server it already leaves out prompts, replies, tool input and output, project and host names, and hashes workspace and session ids; this server refuses them anyway.

## Endpoints

- `POST /v1/traces`: OTLP/HTTP JSON (`Content-Type: application/json`, optionally `Content-Encoding: gzip`), at most 1 MB. Protobuf isn't taken.
- `POST /v1/metrics`: taken and dropped.
- `GET /`: the dashboard, behind the owner key: installs, turns per day, turns by agent, provider and model, tokens, cost, top tools and error rate, for the last 7, 30 or 90 days.

Writes: with the secret `WRITE_KEY` set, every write needs `Authorization: Bearer <WRITE_KEY>`. Without it (Magnum's own deployment) writes are anonymous and rate-limited per install id and per IP address.

## Deploy your own

You need a Cloudflare account and Node 22 or later.

```bash
git clone https://github.com/wenod/magnum-telemetry && cd magnum-telemetry
npm install
npx wrangler login
```

Create the database and put its id in `wrangler.jsonc` (`d1_databases[0].database_id`):

```bash
npx wrangler d1 create magnum-telemetry
```

In `wrangler.jsonc`, change the route to your own domain (a hostname in a zone on the same account), or remove `routes` and set `"workers_dev": true` to use `magnum-telemetry.<you>.workers.dev`. Then create the tables, set the keys and deploy:

```bash
npx wrangler d1 migrations apply DB --remote
```

```bash
npx wrangler secret put OWNER_KEY
```

```bash
npx wrangler secret put WRITE_KEY
```

```bash
npx wrangler deploy
```

`OWNER_KEY` opens the dashboard; pick a long random one (`openssl rand -base64 32`). `WRITE_KEY` is what Magnum sends; leave it unset only for a public, anonymous server. With two Cloudflare accounts, set `CLOUDFLARE_ACCOUNT_ID` to the one that holds the zone.

## Point Magnum at it

In Magnum, open a workspace's **Settings › OpenTelemetry**, and under **Send to** pick **Your server**:

- **Address**: the Worker's URL, e.g. `https://telemetry.example.com` (Magnum adds `/v1/traces` and `/v1/metrics`).
- **Header**: `Authorization`, value `Bearer <WRITE_KEY>`.

Then open the Worker's URL in a browser and sign in with `OWNER_KEY`.

## Try it with curl

A turn with one tool call, as Magnum sends it, dated now:

```bash
NOW=$(date +%s)
curl -sS https://telemetry.example.com/v1/traces \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $WRITE_KEY" \
  --data-binary @- <<EOF
{"resourceSpans":[{"resource":{"attributes":[
  {"key":"service.name","value":{"stringValue":"magnum"}},
  {"key":"service.version","value":{"stringValue":"0.120.0"}},
  {"key":"magnum.install.id","value":{"stringValue":"curl-sample"}}]},
 "scopeSpans":[{"scope":{"name":"magnum","version":"0.120.0"},"spans":[
  {"traceId":"0af7651916cd43dd8448eb211c80319c","spanId":"b7ad6b7169203331","name":"invoke_agent claude_code","kind":3,
   "startTimeUnixNano":"${NOW}000000000","endTimeUnixNano":"$((NOW + 4))000000000",
   "attributes":[
    {"key":"gen_ai.operation.name","value":{"stringValue":"invoke_agent"}},
    {"key":"gen_ai.provider.name","value":{"stringValue":"anthropic"}},
    {"key":"gen_ai.agent.name","value":{"stringValue":"claude_code"}},
    {"key":"gen_ai.request.model","value":{"stringValue":"claude-haiku-5-5"}},
    {"key":"gen_ai.response.model","value":{"stringValue":"claude-haiku-5-5"}},
    {"key":"gen_ai.response.finish_reasons","value":{"arrayValue":{"values":[{"stringValue":"end_turn"}]}}},
    {"key":"gen_ai.usage.input_tokens","value":{"intValue":"300"}},
    {"key":"gen_ai.usage.output_tokens","value":{"intValue":"40"}},
    {"key":"gen_ai.usage.cache_read.input_tokens","value":{"intValue":"200"}},
    {"key":"magnum.cost.usd","value":{"doubleValue":0.01}}],
   "events":[{"timeUnixNano":"${NOW}500000000","name":"magnum.ask","attributes":[]}],
   "status":{}},
  {"traceId":"0af7651916cd43dd8448eb211c80319c","spanId":"00f067aa0ba902b7","parentSpanId":"b7ad6b7169203331","name":"execute_tool Bash","kind":1,
   "startTimeUnixNano":"$((NOW + 1))000000000","endTimeUnixNano":"$((NOW + 2))000000000",
   "attributes":[
    {"key":"gen_ai.operation.name","value":{"stringValue":"execute_tool"}},
    {"key":"gen_ai.tool.name","value":{"stringValue":"Bash"}},
    {"key":"gen_ai.tool.type","value":{"stringValue":"function"}},
    {"key":"gen_ai.agent.name","value":{"stringValue":"claude_code"}}],
   "status":{}}]}]}]}
EOF
```

It answers `{}`. Leave out the `Authorization` line on a server without `WRITE_KEY`.

## Develop

```bash
npm install
npx wrangler d1 migrations apply DB --local
echo 'OWNER_KEY=dev' > .dev.vars
npm run dev
```

`npm test` runs the OTLP parsing tests; `npm run check` type-checks.

## License

MIT
