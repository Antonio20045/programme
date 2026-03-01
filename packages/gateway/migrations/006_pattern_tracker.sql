-- Pattern Tracker (repeated request detection + agent suggestions)
CREATE TABLE IF NOT EXISTS request_patterns (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  query_text  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_request_patterns_user_category ON request_patterns(user_id, category);

CREATE TABLE IF NOT EXISTS pattern_suggestions (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category          TEXT NOT NULL,
  suggested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed         BOOLEAN NOT NULL DEFAULT FALSE,
  created_agent_id  TEXT,
  UNIQUE(user_id, category)
);
