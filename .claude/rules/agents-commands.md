# Agents & Commands

## Verfügbare Agents

In `.claude/agents/`: code-reviewer, security-auditor (OWASP+Electron+LLM-aware), researcher (Sonnet), qa, devils-advocate (3 Modi: Security-Debate, Architektur-Debate, Risk-Assessment), pentester (aktive Exploit-Verifikation mit Proof-of-Concepts, model: opus).

## Custom Commands

- `/new-tool [name] | [beschreibung]` — Tool mit Tests und Security-Checks erstellen
- `/security-scan [--full]` — Fünffach-Audit mit adversarialer Debate (optional Pentest bei `--full`)
- `/phase-complete [nr] | [nächster-schritt]` — Phase abschließen mit allen Checks
- `/learn` — Patterns aus aktueller Session extrahieren und in docs/learnings.md speichern
- `/agentshield` — AgentShield Security-Scan auf Claude Code Konfiguration

## Projektstruktur

pnpm Monorepo mit Workspaces (`apps/*`, `packages/*`). TypeScript path aliases: `@ki-assistent/shared` → `packages/shared/src`, `@ki-assistent/tools` → `packages/tools/src`.

```
apps/
  desktop/          Electron (electron-vite + React + Tailwind + TS)
    src/main/       Main Process: index.ts, gateway-manager.ts, agent.ts, tray.ts, oauth-server.ts, memory-reader.ts
    src/renderer/   React UI (HashRouter): App.tsx, pages/, components/, hooks/
    src/preload/    IPC-Bridge (contextBridge): Gateway-Proxy, Config, Integrations
  mobile/           React Native + Expo
    src/screens/    Pairing, Chat, Settings
    src/services/   relay.ts, encryption.ts, push.ts

packages/
  gateway/          OpenClaw Fork (NUR additive Änderungen)
  tools/            ALLE Tools selbst geschrieben (AgentTool Interface)
    src/            web-search, filesystem, shell, browser, gmail, calendar, reminders, notes, agent-memory, agent-registry, pattern-tracker, model-resolver, agent-executor, delegate-tool, orchestrator-classifier, pending-approvals, agent-lifecycle, agent-factory
    src/verify.ts   Tool-Signatur-Verifikation (Ed25519)
    __tests__/      Verhalten + Security pro Tool
  relay/            Cloudflare Worker (WebSocket-Relay, Pairing, Push)
  shared/           Types, Encryption (X25519+XSalsa20), Constants

scripts/            sign-tools.ts, audit-deps.ts, generate-tray-icons.ts
.claude/            agents/, commands/, hooks/, settings.json
```
