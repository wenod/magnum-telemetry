-- One row per agent turn (`invoke_agent` span).
CREATE TABLE turns (
  at INTEGER NOT NULL,            -- start, ms since the epoch
  install TEXT,                   -- magnum.install.id
  agent TEXT,                     -- gen_ai.agent.name
  provider TEXT,                  -- gen_ai.provider.name
  model TEXT,                     -- gen_ai.response.model, else gen_ai.request.model
  duration_ms INTEGER NOT NULL,
  input_tokens INTEGER,           -- gen_ai.usage.input_tokens
  output_tokens INTEGER,          -- gen_ai.usage.output_tokens
  cache_read_tokens INTEGER,      -- gen_ai.usage.cache_read.input_tokens
  cache_write_tokens INTEGER,     -- gen_ai.usage.cache_write.input_tokens
  cost_usd REAL,                  -- magnum.cost.usd
  error TEXT,                     -- error.type
  asks INTEGER NOT NULL,          -- magnum.ask events
  version TEXT                    -- resource service.version
);
CREATE INDEX turns_at ON turns (at);

-- One row per tool call (`execute_tool` span).
CREATE TABLE tools (
  at INTEGER NOT NULL,
  install TEXT,
  agent TEXT,
  tool TEXT,                      -- gen_ai.tool.name
  duration_ms INTEGER NOT NULL,
  failed INTEGER NOT NULL         -- 1 when error.type was set
);
CREATE INDEX tools_at ON tools (at);
