-- Agent Budgets (per-agent daily token + tool-call tracking)
CREATE TABLE IF NOT EXISTS agent_budgets (
  agent_id      TEXT NOT NULL REFERENCES agent_registry(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  budget_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  tool_calls    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(agent_id, budget_date)
);
CREATE INDEX IF NOT EXISTS idx_agent_budgets_agent_date ON agent_budgets(agent_id, budget_date);
CREATE INDEX IF NOT EXISTS idx_agent_budgets_user ON agent_budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_budgets_date ON agent_budgets(budget_date);
