-- oauth_providers: Generische Provider-Konfiguration
CREATE TABLE IF NOT EXISTS oauth_providers (
  id                    TEXT PRIMARY KEY,
  display_name          TEXT NOT NULL,
  client_id             TEXT NOT NULL,
  client_secret_enc     TEXT NOT NULL,
  authorize_url         TEXT NOT NULL,
  token_url             TEXT NOT NULL,
  revoke_url            TEXT,
  scopes                JSONB NOT NULL DEFAULT '{}',
  icon_url              TEXT,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Placeholder for Google (so FK constraint can reference it)
INSERT INTO oauth_providers (id, display_name, client_id, client_secret_enc, authorize_url, token_url, revoke_url, scopes, enabled)
VALUES (
  'google',
  'Google',
  'pending',
  'pending',
  'https://accounts.google.com/o/oauth2/v2/auth',
  'https://oauth2.googleapis.com/token',
  'https://oauth2.googleapis.com/revoke',
  '{"gmail": "https://www.googleapis.com/auth/gmail.modify", "calendar": "https://www.googleapis.com/auth/calendar.events"}',
  false
) ON CONFLICT (id) DO NOTHING;

-- FK on user_oauth_tokens.provider → oauth_providers.id
ALTER TABLE user_oauth_tokens
  ADD CONSTRAINT fk_provider FOREIGN KEY (provider) REFERENCES oauth_providers(id);
