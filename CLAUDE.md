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

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management
1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Referenzen (bei Bedarf lesen)

Architektur: docs/architecture.md | Struktur: docs/structure.md | OpenClaw: docs/openclaw-analyse.md
Security: .claude/rules/security.md | Fork: .claude/rules/fork-rules.md
Tools: .claude/rules/tool-interface.md | Channel: .claude/rules/channel-adapter.md
Message-Flow: .claude/rules/message-flow.md | DB: .claude/rules/database.md

## Aktueller Stand

Phase: 12 — Sub-Agent Executor (model-resolver fertig)
Nächster Schritt: Agent Executor, Delegate-Tool, Orchestrator
Letzter Commit: feat: add model-resolver with Gemini-First routing logic
