# Caveats

## Gateway

- Bindet auf 127.0.0.1, NIEMALS 0.0.0.0
- Gateway-Fork ist von typecheck, lint, test und audit-deps excludet (eigene tsconfig, zu groß für Root-Checks)
- Model-Routing: PostgreSQL → `classify()` + `resolveModelForAgent()` (Gemini-First, Anthropic-Fallback). SQLite → `selectModel()` + `resolveModel()`. User-Override via `getUserDefaultModel()` (ENV > Config). Fehlender `GEMINI_API_KEY` → sofort Anthropic-Fallback ohne Retry.

## Relay

- Zero Knowledge — kein console.log/info/debug, kein Message Storage

## Encryption

- Mobile ↔ Gateway: E2E verschlüsselt (X25519 + XSalsa20-Poly1305, tweetnacl-js Client, sodium-native Server)
- OAuth Tokens gehören in den OS Keychain, nicht in Config-Dateien

## Dependencies

- Zero high/critical in npm audit
- audit-deps: Build-Output (`out/`, `release/`, `dist/`) wird vom Secret/Pattern-Scan excludet. Dev-Tool-Transitive-Deps (expo, electron-builder, eslint) sind als Warnings geloggt, blockieren nicht.

## Electron

- `will-navigate` blockiert, `setWindowOpenHandler` deny — keine externen URLs, keine neuen Fenster
- `contextIsolation: true`, `sandbox: true`, kein `nodeIntegration`, kein `remote`
- HashRouter statt BrowserRouter (Electron nutzt `file://` in Production)
- IPC-Daten werden mit Type Guard validiert bevor sie in den Renderer State gehen
- Auth-Token bleibt im Main Process — Renderer nutzt `gateway:fetch` Proxy für authentifizierte API-Calls. `getStreamUrl` IPC liefert SSE-URL mit Token nur für Server-Modus.
- Gateway-Modus (Lokal/Server) konfigurierbar in Settings. Config in `~/.openclaw/openclaw.json`, Token in `~/.openclaw/agent-token` (0o600).
- URL-Validierung bei Gateway-Config — nur http:// und https:// erlaubt (kein file://, javascript: etc.)

## MCP-Server

- `.mcp.json` steht in `.gitignore` (enthält potenziell Tokens). Nach einem frischen Clone muss sie manuell erstellt werden mit den Einträgen für `github`, `context7` und `playwright`. Zusätzlich muss `enabledMcpjsonServers` in `.claude/settings.local.json` die gleichen Server-Namen enthalten.
