# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Persönlicher KI-Assistent für Nicht-Entwickler. Electron Desktop + React Native Mobile als Wrapper um eine geforkte OpenClaw-Engine. 60-Sekunden-Onboarding, alle Tools selbstgeschrieben und signiert.

## WICHTIG — Absolute Regeln

- **KEINE bestehenden OpenClaw-Dateien ändern.** NUR 3 additive Änderungen: `config.ts` (Headless-Flag), `channels/in-app.ts` (neuer Channel), `tools.allowExternal = false` (Lockdown). Upstream Merge muss IMMER möglich bleiben.
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
- Electron: `will-navigate` blockiert, `setWindowOpenHandler` deny — keine externen URLs, keine neuen Fenster
- Electron: `contextIsolation: true`, `sandbox: true`, kein `nodeIntegration`, kein `remote`
- Electron: HashRouter statt BrowserRouter (Electron nutzt `file://` in Production)
- Electron: IPC-Daten werden mit Type Guard validiert bevor sie in den Renderer State gehen
- MCP-Server: `.mcp.json` steht in `.gitignore` (enthält potenziell Tokens). Nach einem frischen Clone muss sie manuell erstellt werden mit den Einträgen für `github`, `context7` und `playwright`. Zusätzlich muss `enabledMcpjsonServers` in `.claude/settings.local.json` die gleichen Server-Namen enthalten.

## Projektstruktur

pnpm Monorepo mit Workspaces (`apps/*`, `packages/*`). TypeScript path aliases: `@ki-assistent/shared` → `packages/shared/src`, `@ki-assistent/tools` → `packages/tools/src`.

```
apps/
  desktop/          Electron (electron-vite + React + Tailwind + TS)
    src/main/       Main Process: index.ts, gateway-manager.ts, tray.ts
    src/renderer/   React UI (HashRouter): App.tsx, pages/, components/, hooks/
      src/pages/    Chat.tsx (Message-UI + File-Upload), Settings.tsx
      src/components/
        Sidebar.tsx         Navigation + SessionList + Gateway-Status
        SessionList.tsx     Session-Liste mit Erstellen/Löschen
        MarkdownMessage.tsx Markdown-Rendering für Assistant-Nachrichten
        ToolExecution.tsx   Collapsible Tool-Ausführungs-Anzeige
        FileDropZone.tsx    Drag&Drop-Zone für Datei-Upload
        FilePreview.tsx     Vorschau angehängter Dateien
        AttachmentButton.tsx Datei-Auswahl-Button
      src/hooks/
        useChat.ts          Chat-Logik (SSE-Stream, Tool-Events, File-Upload)
        useSessions.ts      Session-Verwaltung (CRUD + aktive Session)
        useGatewayStatus.ts Gateway-Status via IPC
      src/config.ts   GATEWAY_URL Konfiguration
    src/preload/    IPC-Bridge (contextBridge): openExternal, openFileDialog
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

Client: useChat verwaltet Messages-State, öffnet EventSource nach POST, baut Assistant-Nachricht aus token-Events, zeigt Tool-Ausführungen als ToolExecution-Komponente. Session-ID wird via Ref persistiert.

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

1. **Plan Mode zuerst** — Shift+Tab bis "Plan". 1 Minute Planung spart 10 Minuten Bauen.
2. **UI-Arbeit: Verify-Loop** — Screenshot → vergleichen → iterieren bis es stimmt.
3. **Feature Branch pro Phase** — `git checkout -b phase-X-name`, nach Abschluss mergen.
4. **Commit nach jedem Teilschritt.**
5. **Extended Thinking nutzen** — Reasoning-Tokens belasten den Context nicht.
6. **/compact bei >60%** — mit Fokus-Anweisung. /clear bei neuem Feature.
7. **Sub-Agents mit Sonnet für Research/QA** — billiger, größerer Context, verschmutzt Parent nicht.

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

## Aktueller Stand

Phase: 5 — abgeschlossen
Nächster Schritt: Phase 6 — Setup Wizard + Admin
Letzter Commit: Phase 5 complete: Tool-Signierung mit Ed25519 (sign + verify + tests)
