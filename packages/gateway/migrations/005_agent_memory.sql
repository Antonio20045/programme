-- ============================================================
-- KI-Assistent: Agent Memory (Sub-Agent isolierter Speicher)
-- Depends on: 004_agent_registry (agent_registry table)
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_memory (
  id              BIGSERIAL PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agent_registry(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  value           JSONB NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accessed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_count    INTEGER NOT NULL DEFAULT 0,
  ttl_days        INTEGER CHECK (ttl_days >= 0),
  UNIQUE(agent_id, user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_user ON agent_memory(agent_id, user_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_category ON agent_memory(agent_id, category);
