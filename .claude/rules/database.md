# Datenbank-Integration

- Tools: Factory Pattern — `createXxxTool(userId, pool/oauth)` statt globale Instanzen.
- Notes/Reminders: Per-User via `createNotesTool(userId, pool)` / `createRemindersInstance(userId, pool)`.
- Gmail/Calendar: Per-User OAuth via `GoogleOAuthContext` (Tokens aus `user_oauth_tokens`, AES-256-GCM verschlüsselt).
- Tool-Factory: `createUserTools(userId, pool)` erstellt alle User-Tools, Gmail/Calendar nur wenn OAuth-Tokens vorhanden.
