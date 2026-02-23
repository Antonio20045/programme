# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Persönlicher KI-Assistent für Nicht-Entwickler. Electron Desktop + React Native Mobile als Wrapper um eine geforkte OpenClaw-Engine. 60-Sekunden-Onboarding, alle Tools selbstgeschrieben und signiert.

## WICHTIG — Absolute Regeln

- **KEINE bestehenden OpenClaw-Dateien ändern.** NUR 4 additive Änderungen: `config.ts` (Headless-Flag), `channels/in-app.ts` (In-App Channel + Cost Optimizer), `tools.allowExternal = false` (Lockdown), `run.ts` (Cost Optimizer Hooks, ~15 Zeilen). Upstream Merge muss IMMER möglich bleiben.
- **KEIN eval(), Function(), exec() mit User-Input.** Keine Ausnahme. spawn/execFile statt exec.
- **Secrets NUR in Env Vars oder OS Keychain.** NIE im Code, NIE in Config-Dateien.
- **NUR tun was im Prompt steht.** Komponente erstellen ≠ anderswo einsetzen. Tool erstellen ≠ in anderen Dateien aufrufen. Im Zweifel: fragen.
- **NIE mit Fehlern committen.** Alle Checks grün, dann committen.
- **Keine neuen Dependencies** ohne explizite Erlaubnis.
- **Nach JEDER Änderung an .tsx oder .css Dateien:** ui-reviewer Agent aufrufen bevor du weitermachst.
- **Bei externen Libraries** (electron-vite, vitest, tailwind, react-router, etc.): IMMER zuerst Context7 nutzen um aktuelle Dokumentation zu lesen, bevor du Code schreibst. Nicht auf Trainingswissen verlassen.

## Befehle — nach JEDER Änderung ausführen

```
pnpm typecheck    # TypeScript strict (noUncheckedIndexedAccess + noImplicitAny)
pnpm lint         # ESLint + eslint-plugin-security
pnpm test         # Vitest
pnpm audit-deps   # pnpm audit + Dangerous Pattern Scan + Secret Scan
```

Einzelnen Test: `pnpm vitest run packages/tools/__tests__/gmail.test.ts`

Tool-Signierung:
```
npx tsx scripts/sign-tools.ts  # Keypair generieren (wenn nötig) + alle Tools signieren
```

App-spezifisch:
```
pnpm dev:desktop  |  pnpm build:desktop    # Electron
pnpm dev:gateway                            # Gateway
pnpm dev:relay                              # Relay
pnpm build:mobile                           # React Native
```

## Caveats

- Gateway bindet auf 127.0.0.1, NIEMALS 0.0.0.0
- Relay: Zero Knowledge — kein console.log/info/debug, kein Message Storage
- Mobile ↔ Gateway: E2E verschlüsselt (X25519 + XSalsa20-Poly1305, tweetnacl-js Client, sodium-native Server)
- OAuth Tokens gehören in den OS Keychain, nicht in Config-Dateien
- Tool-Signierung: Ed25519 — `sign-tools.ts` signiert mit libsodium, `verify.ts` prüft mit Node crypto (timingSafeEqual + crypto.verify). Private Key NUR in `.env`, Public Key in `public-key.ts`. Gateway ruft `verifyTool()` vor dem Laden auf.
- Dependencies: Zero high/critical in npm audit
- Kein fetch() in Tools außer an dokumentierte APIs (Gmail, Calendar, Search)
- Pfad-Validierung gegen Whitelist bei jedem Dateizugriff (Path Traversal Schutz)
- Gateway-Fork ist von typecheck, lint, test und audit-deps excludet (eigene tsconfig, zu groß für Root-Checks)
- audit-deps: Build-Output (`out/`, `release/`, `dist/`) wird vom Secret/Pattern-Scan excludet. Dev-Tool-Transitive-Deps (expo, electron-builder, eslint) sind als Warnings geloggt, blockieren nicht.
- Electron: `will-navigate` blockiert, `setWindowOpenHandler` deny — keine externen URLs, keine neuen Fenster
- Electron: `contextIsolation: true`, `sandbox: true`, kein `nodeIntegration`, kein `remote`
- Electron: HashRouter statt BrowserRouter (Electron nutzt `file://` in Production)
- Electron: IPC-Daten werden mit Type Guard validiert bevor sie in den Renderer State gehen
- Electron: Auth-Token bleibt im Main Process — Renderer nutzt `gateway:fetch` Proxy für authentifizierte API-Calls. `getStreamUrl` IPC liefert SSE-URL mit Token nur für Server-Modus.
- Electron: Gateway-Modus (Lokal/Server) konfigurierbar in Settings. Config in `~/.openclaw/openclaw.json`, Token in `~/.openclaw/agent-token` (0o600).
- Electron: URL-Validierung bei Gateway-Config — nur http:// und https:// erlaubt (kein file://, javascript: etc.)
- MCP-Server: `.mcp.json` steht in `.gitignore` (enthält potenziell Tokens). Nach einem frischen Clone muss sie manuell erstellt werden mit den Einträgen für `github`, `context7` und `playwright`. Zusätzlich muss `enabledMcpjsonServers` in `.claude/settings.local.json` die gleichen Server-Namen enthalten.

## Projektstruktur

pnpm Monorepo mit Workspaces (`apps/*`, `packages/*`). TypeScript path aliases: `@ki-assistent/shared` → `packages/shared/src`, `@ki-assistent/tools` → `packages/tools/src`.

```
apps/
  desktop/          Electron (electron-vite + React + Tailwind + TS)
    src/main/       Main Process: index.ts, gateway-manager.ts, agent.ts, tray.ts, oauth-server.ts, memory-reader.ts
    src/renderer/   React UI (HashRouter): App.tsx, pages/, components/, hooks/
      src/pages/    Chat.tsx (Message-UI + File-Upload), Settings.tsx, Setup.tsx
      src/components/
        Sidebar.tsx         Navigation + SessionList + Gateway/Agent-Status
        SessionList.tsx     Session-Liste mit Erstellen/Löschen
        MarkdownMessage.tsx Markdown-Rendering für Assistant-Nachrichten
        ToolExecution.tsx   Collapsible Tool-Ausführungs-Anzeige
        ToolConfirmation.tsx Tool-Bestätigungs-Dialog
        Toast.tsx           Toast-Benachrichtigungen
        FileDropZone.tsx    Drag&Drop-Zone für Datei-Upload
        FilePreview.tsx     Vorschau angehängter Dateien
        AttachmentButton.tsx Datei-Auswahl-Button
      src/hooks/
        useChat.ts          Chat-Logik (SSE-Stream, Tool-Events, File-Upload)
        useSessions.ts      Session-Verwaltung (CRUD + aktive Session)
        useGatewayStatus.ts Gateway-Status via IPC
        useGatewayConfig.ts Gateway-Config (Modus, URL, Token) via IPC
      src/config.ts   Gateway-URL + Modus-Cache (dynamisch)
      src/constants.ts Provider/Model/Tone-Konstanten
    src/preload/    IPC-Bridge (contextBridge): Gateway-Proxy, Config, Integrations
  mobile/           React Native + Expo
    src/screens/    Pairing, Chat, Settings
    src/services/   relay.ts, encryption.ts, push.ts

packages/
  gateway/          OpenClaw Fork (NUR 3 neue Dateien: config.ts, channels/in-app.ts, tool-router.ts)
  tools/            ALLE Tools selbst geschrieben (AgentTool Interface)
    src/            web-search, filesystem, shell, browser, gmail, calendar, reminders, notes
    src/verify.ts   Tool-Signatur-Verifikation (Ed25519 via Node crypto, zero Dependencies)
    src/public-key.ts Ed25519 Public Key (generiert von sign-tools.ts)
    signatures.json Ed25519-Signaturen aller Tool-Dateien (generiert von sign-tools.ts)
    __tests__/      Verhalten + Security pro Tool
  relay/            Cloudflare Worker (WebSocket-Relay, Pairing, Push)
  shared/           Types, Encryption (X25519+XSalsa20), Constants

scripts/            sign-tools.ts, audit-deps.ts, generate-tray-icons.ts
.claude/            agents/, commands/, hooks/, settings.json
```

## Tool-Interface (OpenClaw AgentTool)

Jedes Tool in `packages/tools/src/` implementiert das OpenClaw `AgentTool`-Interface:

```typescript
interface AgentTool {
  name: string
  description: string
  parameters: JSONSchema          // JSON Schema für Argumente
  execute: (args: unknown) => Promise<unknown>
}
```

Tools werden via LLM-native Function Calling aufgerufen (nicht String-Parsing).
Registrierung über `createOpenClawCodingTools()` in `register.ts`.

Jedes Tool braucht Verhaltens-Tests UND Security-Tests (kein eval, kein unauthorisierter fetch, kein Path Traversal).

## Channel-Adapter Interface (OpenClaw ChannelPlugin)

Unser In-App Channel in `packages/gateway/channels/in-app.ts` implementiert:

```typescript
import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk"

// ChannelPlugin<TAccount, TProbe> mit diesen Pflicht-Feldern:
const inAppPlugin: ChannelPlugin<InAppAccount, InAppProbe> = {
  id: "in-app",
  meta:         { /* label, docs, blurb */ },
  capabilities: { /* chatTypes, media, reactions */ },
  config:       { /* list, resolve, create, delete accounts */ },
  security:     { /* dmPolicy, pairing, allowlists */ },
  gateway:      { /* startAccount, logoutAccount */ },
  outbound:     { /* sendText, sendMedia */ },
}

// Registrierung im Plugin-Entry:
// api.registerChannel({ plugin: inAppPlugin as ChannelPlugin })
```

Siehe `docs/openclaw-analyse.md` Abschnitt 3 für vollständiges Telegram-Beispiel.

## Nachrichtenfluss (Kurzfassung)

User → POST /api/message (JSON oder FormData mit Dateien) → Gateway → LLM → Text-Antwort (SSE Stream) ODER Tool-Aufruf → Tool Router: Server-Tool direkt ausführen / Lokales Tool an Desktop Agent via WS → Ergebnis zurück an LLM → nächste Aktion oder fertig.

SSE Events: `token` (Text-Chunks), `tool_start` (JSON: toolName + params), `tool_result` (JSON: toolName + result), `done`, `error`.

Client: useChat verwaltet Messages-State, postet via `gateway:fetch` Proxy (JSON) oder direkten `fetch` (FormData), öffnet EventSource nach POST (URL via `getStreamUrl` IPC), baut Assistant-Nachricht aus token-Events, zeigt Tool-Ausführungen als ToolExecution-Komponente. Session-ID wird via Ref persistiert.

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

## Workflow

1. **Plan Mode zuerst** — Shift+Tab. Implementiere NICHTS ohne bestätigten Plan.
2. **Commit nach jedem Teilschritt.** Git ist dein Undo-Button.
3. **/clear nach jedem Feature oder Themenwechsel.** NIEMALS /compact. Bei Bedarf: /catchup für Kontext-Wiederherstellung.
4. **Debugging: Runtime-First.** /debug [problem] oder debugger-Agent nutzen. NIEMALS Code statisch analysieren und "Root Cause" raten.
5. **Zwei-Strikes-Regel:** Nach 2 fehlgeschlagenen Fix-Versuchen → Handoff-Dokument schreiben → /clear → /catchup → neu anfangen.
6. **Starte Claude im Unterverzeichnis** wenn du nur an einem Package arbeitest (z.B. `cd apps/desktop && claude`).
7. **1 Aufgabe pro Session.** Keine thematischen Sprünge.

## Verfügbare Agents

In `.claude/agents/`: code-reviewer, security-auditor (OWASP+Electron+LLM-aware), researcher (Sonnet), qa, devils-advocate (3 Modi: Security-Debate, Architektur-Debate, Risk-Assessment), pentester (aktive Exploit-Verifikation mit Proof-of-Concepts, model: opus).

## Custom Commands

- `/new-tool [name] | [beschreibung]` — Tool mit Tests und Security-Checks erstellen
- `/security-scan [--full]` — Fünffach-Audit mit adversarialer Debate (optional Pentest bei `--full`)
- `/phase-complete [nr] | [nächster-schritt]` — Phase abschließen mit allen Checks
- `/learn` — Patterns aus aktueller Session extrahieren und in docs/learnings.md speichern
- `/agentshield` — AgentShield Security-Scan auf Claude Code Konfiguration

## Weitere Dokumentation

| Thema | Datei | Wann lesen |
|-------|-------|------------|
| OpenClaw Source-Analyse | `docs/openclaw-analyse.md` | Bei Arbeit am Gateway/Fork, Channel-Adapter, Tool-System |
| Architektur-Diagramm + Flows | `docs/architecture.md` | Bei Architektur-Fragen oder neuen Komponenten |
| Monorepo-Struktur | `docs/structure.md` | Wenn unklar wo eine Datei hingehört |
| Security-Regeln (Detail) | `.claude/rules/security.md` | Bei Security-relevanter Arbeit |
| Fork-Regeln (Detail) | `.claude/rules/fork-rules.md` | Bei Arbeit am Gateway/OpenClaw |
| Workflow (Detail) | `.claude/rules/workflow.md` | Bei Fragen zum Entwicklungsprozess |

## Datenbank-Integration

- Tools: Factory Pattern — `createXxxTool(userId, pool/oauth)` statt globale Instanzen.
- Notes/Reminders: Per-User via `createNotesTool(userId, pool)` / `createRemindersInstance(userId, pool)`.
- Gmail/Calendar: Per-User OAuth via `GoogleOAuthContext` (Tokens aus `user_oauth_tokens`, AES-256-GCM verschlüsselt).
- Tool-Factory: `createUserTools(userId, pool)` erstellt alle User-Tools, Gmail/Calendar nur wenn OAuth-Tokens vorhanden.

## Aktueller Stand

Phase: 11 — Prototyp finalisieren (App bauen, Chat end-to-end testen)
Naechster Schritt: Phase 12 — Chat end-to-end testen (manuell), dann Stabilisierung
Letzter Commit: Phase 11: Gateway-Startup-Fixes + Security-Hardening
