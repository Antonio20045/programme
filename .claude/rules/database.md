# Datenbank-Integration

- Tools: Factory Pattern — `createXxxTool(userId, pool/oauth)` statt globale Instanzen.
- Notes/Reminders: Per-User via `createNotesTool(userId, pool)` / `createRemindersInstance(userId, pool)`.
- Gmail/Calendar: Per-User OAuth via `GoogleOAuthContext` (Tokens aus `user_oauth_tokens`, AES-256-GCM verschlüsselt).
- Agent Memory: Per-Agent per-User via `agent-memory.ts` — isolierter Key-Value-Store (JSONB). Funktionen: `set/get/getAll/getByCategory/deleteKey/deleteNamespace/cleanupExpired/cleanupStaleCache/formatForSystemPrompt`. TTL per Kategorie (preference=∞, learned=90d, state=1d, cache=explizit). Migration: 005.
- Agent Registry: Per-User via `agent-registry.ts` — CRUD für Sub-Agent-Definitionen (max 20 pro User). Funktionen: `createAgent/getAgent/getUserAgents/getActiveAgents/updateAgent/updateStatus/touchAgent/deleteAgent`. ID: kebab-case Name + 6 Hex. Migration: 004. Lokal (SQLite) deaktiviert wie Notes/Reminders.
- Tool-Factory: `createUserTools(userId, pool)` erstellt alle User-Tools, Gmail/Calendar nur wenn OAuth-Tokens vorhanden.
