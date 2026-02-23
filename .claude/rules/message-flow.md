# Nachrichtenfluss

User → POST /api/message (JSON oder FormData mit Dateien) → Gateway → LLM → Text-Antwort (SSE Stream) ODER Tool-Aufruf → Tool Router: Server-Tool direkt ausführen / Lokales Tool an Desktop Agent via WS → Ergebnis zurück an LLM → nächste Aktion oder fertig.

## SSE Events

- `token` — Text-Chunks
- `tool_start` — JSON: toolName + params
- `tool_result` — JSON: toolName + result
- `done`
- `error`

## Client-Seite

useChat verwaltet Messages-State, postet via `gateway:fetch` Proxy (JSON) oder direkten `fetch` (FormData), öffnet EventSource nach POST (URL via `getStreamUrl` IPC), baut Assistant-Nachricht aus token-Events, zeigt Tool-Ausführungen als ToolExecution-Komponente. Session-ID wird via Ref persistiert.

Tools mit Bestätigungspflicht: SSE Event → Client zeigt Vorschau → User bestätigt → erst dann ausführen.

## Hooks (automatisch bei Write/Edit)

PostToolUse-Hooks laufen nach jeder Dateiänderung. Zero output bei Erfolg, max 5 Zeilen bei Fehler:
- `check.sh` — TypeScript + ESLint (nur .ts/.tsx)
- `security-check.sh` — Pattern-Scan (eval, exec, innerHTML, Secrets) pro Datei
- `test-check.sh` — Test-Existenz + Ausführung für src/-Dateien
- `dependency-check.sh` — pnpm audit bei package.json-Änderungen

Stop-Hook: `check.sh` läuft auch beim Beenden.

PreToolUse-Hook:
- `block-unnecessary-docs.sh` — Blockiert Erstellen von .md/.txt außerhalb von docs/, README.md, CLAUDE.md
