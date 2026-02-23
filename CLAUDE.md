# KI-Assistent

Electron + React + TypeScript Monorepo. pnpm Workspaces.

## Absolute Regeln

1. FORK: NUR Gateway-Dateien ändern: config.ts, channels/in-app.ts, channels/in-app-sqlite.ts, tool-router.ts, extensions/in-app-channel/index.ts. Alles andere = OpenClaw-Core = VERBOTEN.
2. SECURITY: Kein eval/new Function/innerHTML. Kein fetch in Tools ohne dokumentierte URL. Secrets nur env/keychain.
3. SCOPE: NUR implementieren was gefragt wurde.
4. DEBUG: IMMER erst Runtime-Output lesen. Nie raten. Siehe .claude/rules/debugging.md
5. ELECTRON: nodeIntegration: false, contextIsolation: true, sandbox: true.
6. TYPES: Kein any. Nach Änderung pnpm typecheck im betroffenen Package.

## Befehle

pnpm typecheck | pnpm lint | pnpm test | pnpm build | pnpm dev | pnpm audit-deps

## Workflow

1. Plan Mode zuerst. Nichts ohne Plan.
2. Commit nach jedem Teilschritt.
3. /clear nach jedem Feature. NIEMALS /compact. Dann /catchup.
4. /debug [problem] bei Bugs. Nie raten.
5. Nach 2 gescheiterten Fixes → Handoff → /clear → /catchup.
6. Eine Aufgabe pro Session.

## Referenzen (bei Bedarf lesen)

Architektur: docs/architecture.md | Struktur: docs/structure.md | OpenClaw: docs/openclaw-analyse.md
Security: .claude/rules/security.md | Fork: .claude/rules/fork-rules.md
Tools: .claude/rules/tool-interface.md | Channel: .claude/rules/channel-adapter.md
Message-Flow: .claude/rules/message-flow.md | DB: .claude/rules/database.md

## Aktueller Stand

Phase: 11 — Prototyp finalisieren
Nächster Schritt: White-Screen-Bug fixen, Chat end-to-end testen
Letzter Commit: improve: Claude Code Workflow-Optimierung
