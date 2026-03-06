ALTER TABLE agent_registry
  ADD COLUMN retention TEXT NOT NULL DEFAULT 'persistent'
  CHECK (retention IN ('persistent', 'seasonal', 'ephemeral'));

ALTER TABLE agent_registry
  ADD COLUMN cron_task TEXT;
