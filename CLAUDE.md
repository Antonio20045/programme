# KI-Assistent

Electron + React + TypeScript Monorepo. pnpm Workspaces.

## Workflow & Prinzipien
Bei nicht-trivialen Tasks (3+ Schritte): Lies und befolge .claude/rules/workflow.md

## Nach Compaction / Session-Start
1. Lies tasks/todo.md — wo stehst du im aktuellen Task?
2. Lies die relevanten Quelldateien NEU — verlass dich NICHT auf Compaction-Zusammenfassungen
3. KEINE Annahmen über Dateiinhalte — lies die Dateien
4. HANDOFF-*.md hat Priorität falls vorhanden

## Absolute Regeln

1. FORK: NUR Gateway-Dateien ändern: config.ts, channels/in-app.ts, channels/in-app-sqlite.ts, tool-router.ts, extensions/in-app-channel/index.ts. Alles andere = OpenClaw-Core = VERBOTEN.
2. SECURITY: Kein eval/new Function/innerHTML. Kein fetch in Tools ohne dokumentierte URL. Secrets nur env/keychain.
3. SCOPE: NUR implementieren was gefragt wurde.
4. DEBUG: IMMER erst Runtime-Output lesen. Nie raten. Siehe .claude/rules/debugging.md
5. ELECTRON: nodeIntegration: false, contextIsolation: true, sandbox: true.
6. TYPES: Kein any. Nach Änderung pnpm typecheck im betroffenen Package.

## Befehle

pnpm typecheck | pnpm lint | pnpm test | pnpm build | pnpm dev | pnpm audit-deps

## Referenzen (bei Bedarf lesen)

Architektur: docs/architecture.md | Struktur: docs/structure.md | OpenClaw: docs/openclaw-analyse.md
Security: .claude/rules/security.md | Fork: .claude/rules/fork-rules.md
Tools: .claude/rules/tool-interface.md | Channel: .claude/rules/channel-adapter.md
Message-Flow: .claude/rules/message-flow.md | DB: .claude/rules/database.md
Workflow: .claude/rules/workflow.md | Contracts: .claude/rules/task-contracts.md

## Aktueller Stand

Phase: 27 — abgeschlossen
Nächster Schritt: Manuelles Testen der System-Prompt-Änderungen (verschiedene Sprachen, connect-google Flow)
Letzter Commit: feat: migrate system prompt to English + fix connect-google routing