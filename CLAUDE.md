# CLAUDE.md

Persönlicher KI-Assistent für Nicht-Entwickler. Electron Desktop + React Native Mobile als Wrapper um eine geforkte OpenClaw-Engine. 60-Sekunden-Onboarding, alle Tools selbstgeschrieben und signiert.

## WICHTIG — Absolute Regeln

- **KEINE bestehenden OpenClaw-Dateien ändern.** NUR 3 additive Änderungen: `config.ts` (Headless-Flag), `channels/in-app.ts` (neuer Channel), `tools.allowExternal = false` (Lockdown). Upstream Merge muss IMMER möglich bleiben.
- **KEIN eval(), Function(), exec() mit User-Input.** Keine Ausnahme. spawn/execFile statt exec.
- **Secrets NUR in Env Vars oder OS Keychain.** NIE im Code, NIE in Config-Dateien.
- **NUR tun was im Prompt steht.** Komponente erstellen ≠ anderswo einsetzen. Tool erstellen ≠ in anderen Dateien aufrufen. Im Zweifel: fragen.
- **NIE mit Fehlern committen.** Alle Checks grün, dann committen.
- **Keine neuen Dependencies** ohne explizite Erlaubnis.

## Befehle — nach JEDER Änderung ausführen

```
pnpm typecheck    # TypeScript strict
pnpm lint         # ESLint + Security
pnpm test         # Vitest
pnpm audit-deps   # npm audit + Dangerous Pattern Scan
```

## Caveats

- Gateway bindet auf 127.0.0.1, NIEMALS 0.0.0.0
- Relay: Zero Knowledge — kein console.log/info/debug, kein Message Storage
- Mobile ↔ Gateway: E2E verschlüsselt (X25519 + XSalsa20-Poly1305, tweetnacl-js Client, sodium-native Server)
- OAuth Tokens gehören in den OS Keychain, nicht in Config-Dateien
- Tool-Signierung: Ed25519 via libsodium — Gateway prüft vor dem Laden
- Dependencies: Zero high/critical in npm audit
- Kein fetch() in Tools außer an dokumentierte APIs (Gmail, Calendar, Search)
- Pfad-Validierung gegen Whitelist bei jedem Dateizugriff (Path Traversal Schutz)

## Projektstruktur

```
apps/
  desktop/          Electron (electron-vite + React + TS)
    src/main/       Main Process: index.ts, agent.ts, tray.ts, updater.ts
    src/renderer/   React UI: Chat.tsx, Admin.tsx, Setup.tsx, components/, hooks/
    src/preload/    IPC-Bridge (contextBridge)
  mobile/           React Native + Expo
    src/screens/    Pairing, Chat, Settings
    src/services/   relay.ts, encryption.ts, push.ts

packages/
  gateway/          OpenClaw Fork (NUR 3 neue Dateien: config.ts, channels/in-app.ts, tool-router.ts)
  tools/            ALLE Tools selbst geschrieben (ToolDefinition Interface)
    src/            web-search, filesystem, shell, browser, gmail, calendar, reminders, notes
    __tests__/      Verhalten + Security pro Tool
  relay/            Cloudflare Worker (WebSocket-Relay, Pairing, Push)
  shared/           Types, Encryption (X25519+XSalsa20), Constants

scripts/            sign-tools, audit-deps, build-installers
.claude/            agents/, commands/, rules/, settings.json
```

## Tool-Interface

Jedes Tool in `packages/tools/src/` implementiert:

```typescript
interface ToolDefinition {
  name: string
  description: string
  permissions: string[]
  actions: Record<string, Action>
  requiresConfirmation: string[]
}
```

Jedes Tool braucht Verhaltens-Tests UND Security-Tests (kein eval, kein unauthorisierter fetch, kein Path Traversal).

## Nachrichtenfluss (Kurzfassung)

User → POST /api/message → Gateway → LLM → Text-Antwort (SSE Stream) ODER Tool-Aufruf → Tool Router: Server-Tool direkt ausführen / Lokales Tool an Desktop Agent via WS → Ergebnis zurück an LLM → nächste Aktion oder fertig.

Tools mit `requiresConfirmation`: SSE Event → Client zeigt Vorschau → User bestätigt → erst dann ausführen.

## Workflow

1. **Plan Mode zuerst** — Shift+Tab bis "Plan". 1 Minute Planung spart 10 Minuten Bauen.
2. **UI-Arbeit: Verify-Loop** — Screenshot → vergleichen → iterieren bis es stimmt.
3. **Feature Branch pro Phase** — `git checkout -b phase-X-name`, nach Abschluss mergen.
4. **Commit nach jedem Teilschritt.**
5. **Extended Thinking nutzen** — Reasoning-Tokens belasten den Context nicht.
6. **/compact bei >60%** — mit Fokus-Anweisung. /clear bei neuem Feature.
7. **Sub-Agents mit Sonnet für Research/QA** — billiger, größerer Context, verschmutzt Parent nicht.

## Verfügbare Agents

In `.claude/agents/`: code-reviewer, security-auditor, researcher (Sonnet), qa, devils-advocate.

## Custom Commands

- `/new-tool [name] | [beschreibung]` — Tool mit Tests und Security-Checks erstellen
- `/security-scan` — Vierfach-Audit mit adversarialer Devil's-Advocate-Debate
- `/phase-complete [nr] | [nächster-schritt]` — Phase abschließen mit allen Checks

## Weitere Dokumentation

| Thema | Datei | Wann lesen |
|-------|-------|------------|
| Architektur-Diagramm + Flows | `docs/architecture.md` | Bei Architektur-Fragen oder neuen Komponenten |
| Monorepo-Struktur | `docs/structure.md` | Wenn unklar wo eine Datei hingehört |
| Security-Regeln (Detail) | `.claude/rules/security.md` | Bei Security-relevanter Arbeit |
| Fork-Regeln (Detail) | `.claude/rules/fork-rules.md` | Bei Arbeit am Gateway/OpenClaw |
| Workflow (Detail) | `.claude/rules/workflow.md` | Bei Fragen zum Entwicklungsprozess |

## Aktueller Stand

Phase: 0 — Noch nicht gestartet
Nächster Schritt: Phase 0.1 — Claude Code installieren
Letzter Commit: (noch keiner)
