CREATE TABLE request_logs (
  id             BIGSERIAL PRIMARY KEY,
  request_id     UUID NOT NULL,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  api_key_id     INTEGER REFERENCES api_keys (id),
  model_alias    TEXT,
  provider       TEXT,
  status         INTEGER NOT NULL,
  latency_ms     INTEGER NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd       NUMERIC(12, 6) NOT NULL DEFAULT 0,
  cache_hit      BOOLEAN NOT NULL DEFAULT false,
  fallback_used  BOOLEAN NOT NULL DEFAULT false,
  attempts       INTEGER NOT NULL DEFAULT 0,
  error_code     TEXT,
  pii_redacted   INTEGER NOT NULL DEFAULT 0,
  -- Only filled when LOG_PROMPTS=true, and then only after PII redaction.
  prompt         TEXT
);

CREATE INDEX request_logs_ts_idx ON request_logs (ts);
CREATE INDEX request_logs_key_ts_idx ON request_logs (api_key_id, ts);
