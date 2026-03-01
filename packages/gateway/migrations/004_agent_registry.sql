-- Agent Registry (Sub-Agent Definitions)
CREATE TABLE IF NOT EXISTS agent_registry (
  id                TEXT PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (length(name) <= 100),
  description       TEXT NOT NULL DEFAULT '',
  system_prompt     TEXT NOT NULL DEFAULT '',
  tools             JSONB NOT NULL DEFAULT '[]',
  model             TEXT NOT NULL DEFAULT 'haiku',
  risk_profile      TEXT NOT NULL DEFAULT 'read-only'
                    CHECK (risk_profile IN ('read-only', 'write-with-approval', 'full-autonomy')),
  max_steps         INTEGER NOT NULL DEFAULT 5,
  max_tokens        INTEGER NOT NULL DEFAULT 4096,
  timeout_ms        INTEGER NOT NULL DEFAULT 30000,
  memory_namespace  TEXT NOT NULL DEFAULT '',
  cron_schedule     TEXT,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'dormant', 'archived')),
  trust_level       TEXT NOT NULL DEFAULT 'intern'
                    CHECK (trust_level IN ('intern', 'junior', 'senior')),
  trust_metrics     JSONB NOT NULL DEFAULT '{"totalTasks":0,"successfulTasks":0,"userOverrides":0,"promotedAt":null}',
  usage_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_registry_user ON agent_registry(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_registry_user_status ON agent_registry(user_id, status);
