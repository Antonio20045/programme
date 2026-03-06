CREATE TABLE IF NOT EXISTS agent_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_user_agent ON agent_events (user_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events (event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events (created_at);
