CREATE TABLE api_keys (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  owner                 TEXT,
  key_prefix            TEXT NOT NULL,
  key_hash              TEXT NOT NULL UNIQUE,
  rate_per_min          INTEGER NOT NULL DEFAULT 60 CHECK (rate_per_min > 0),
  burst                 INTEGER NOT NULL DEFAULT 60 CHECK (burst > 0),
  monthly_token_budget  BIGINT NOT NULL DEFAULT 1000000 CHECK (monthly_token_budget >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at            TIMESTAMPTZ
);
