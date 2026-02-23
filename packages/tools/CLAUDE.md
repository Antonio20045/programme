# Tools (Selbst geschrieben)

## Interface
Jedes Tool implementiert OpenClaw AgentTool:
- name, description, parameters (JSON Schema), execute(args) → Promise

## Registrierung
Via createOpenClawCodingTools() in register.ts.
Per-User Tools via AsyncLocalStorage (createUserTools).

## Sicherheitsregeln
- Kein eval(), kein new Function()
- Kein fetch() ohne dokumentierte URL
- Path Traversal Schutz (allowedDirectories)
- Shell: execFile/spawn, NICHT exec. Args als Array.
- Jedes Tool braucht Verhaltens-Tests UND Security-Tests

## Befehle
- `pnpm --filter @ki-assistent/tools test` — Tool-Tests
- `pnpm --filter @ki-assistent/tools typecheck` — TypeScript
