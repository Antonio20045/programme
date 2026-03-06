# Nachrichtenfluss

User → POST /api/message (JSON oder FormData mit Dateien) → Gateway → LLM → Text-Antwort (SSE Stream) ODER Tool-Aufruf → Tool Router: Server-Tool direkt ausführen / Lokales Tool an Desktop Agent via WS → Ergebnis zurück an LLM → nächste Aktion oder fertig.

## SSE Events

- `token` — Text-Chunks
- `tool_start` — JSON: toolName + params
- `tool_result` — JSON: toolName + result
- `session_title` — JSON: `{ sessionId, title }` — LLM-generierter Chat-Titel, asynchron nach erstem Austausch
- `done`
- `error`
- `notification` — Proaktive Sub-Agent Notification (separater SSE-Stream auf `/api/notifications`)

## Client-Seite

useChat verwaltet Messages-State, postet via `gateway:fetch` Proxy (JSON) oder direkten `fetch` (FormData), öffnet EventSource nach POST (URL via `getStreamUrl` IPC), baut Assistant-Nachricht aus token-Events, zeigt Tool-Ausführungen als ToolExecution-Komponente. Session-ID wird via Ref persistiert. EventSource bleibt nach `done` max 15s offen für asynchrone `session_title`-Events, schließt danach automatisch.

## Session-Titel-Generierung

Nach dem ersten Austausch (1 User + 1 Assistant Message) generiert das Gateway asynchron einen Chat-Titel:
1. `deliverResponse()` prüft Message-Count (== 2) → fire-and-forget `generateSessionTitle()`
2. Cheap LLM-Call (Haiku-Tier) mit User- + Assistant-Text (je max 200 Zeichen)
3. Titel wird durch `sanitizeOutputText()` gefiltert, in DB gespeichert (user-scoped), via `session_title` SSE-Event gepusht
4. Client `useChat` empfängt Event → `onTitleUpdate` Callback → `useSessions.updateSessionTitle()` aktualisiert Sidebar live

Tools mit Bestätigungspflicht: SSE Event → Client zeigt Vorschau → User bestätigt → erst dann ausführen.

## Response-Mode Enforcement

Classifier bestimmt `responseMode` (action/answer/conversation) vor dem LLM-Call. Gateway injiziert mode-spezifische System-Prompt-Instruktion:
- **action** — Sofort Tool-Calls, kein einleitender Text, Ergebnis max 2 Sätze
- **answer** — Kurze direkte Antwort, max 2-3 Sätze
- **conversation** — Keine zusätzliche Instruktion

Output-Monitor (`monitorResponseMode`) loggt Violations: action >150 Zeichen vor Tool-Call, answer >250 Zeichen. Rein observierend, blockiert nicht.

## Proaktive Notifications (Sub-Agents)

Sub-Agent produziert Ergebnis → Gateway NotificationStore (in-memory, max 200, 24h TTL) → SSE GET /api/notifications (persistent stream, 30s heartbeat) → Desktop Main Process → drei parallele Pfade:
1. **IPC** → Renderer `useNotifications` Hook → `NotificationBanner` Komponente
2. **Native OS Notification** (Electron `Notification` API, click → Fenster fokussieren)
3. **Mobile-Forwarding** (wenn gepairt): verschlüsselt via Relay WS → Mobile `useChat` rendert als Assistant-Message

Ack: Renderer → `acknowledgeNotification` IPC → Gateway POST `/api/notifications/:id/ack`.

## Hooks (automatisch bei Write/Edit)

PostToolUse-Hooks laufen nach jeder Dateiänderung. Zero output bei Erfolg, max 5 Zeilen bei Fehler:
- `check.sh` — TypeScript + ESLint (nur .ts/.tsx)
- `security-check.sh` — Pattern-Scan (eval, exec, innerHTML, Secrets) pro Datei
- `test-check.sh` — Test-Existenz + Ausführung für src/-Dateien
- `dependency-check.sh` — pnpm audit bei package.json-Änderungen

Stop-Hook: `check.sh` läuft auch beim Beenden.

PreToolUse-Hook:
- `block-unnecessary-docs.sh` — Blockiert Erstellen von .md/.txt außerhalb von docs/, README.md, CLAUDE.md
