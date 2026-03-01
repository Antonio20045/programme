# Tool-Interface (OpenClaw AgentTool)

Jedes Tool in `packages/tools/src/` implementiert `ExtendedAgentTool`:

```typescript
type RiskTier = 0 | 1 | 2 | 3 | 4

interface ExtendedAgentTool {
  name: string
  description: string
  parameters: JSONSchema
  permissions: readonly string[]
  requiresConfirmation: boolean       // Legacy — replaced by riskTiers
  runsOn: 'server' | 'desktop'
  riskTiers?: Record<string, RiskTier>  // Per-action risk tier
  defaultRiskTier?: RiskTier            // Fallback when action not in riskTiers
  execute: (args: unknown) => Promise<AgentToolResult>
}
```

### Risk Tiers (0-4)
- **0** — Pure compute (calculator, datetime, json-tools). Auto-execute.
- **1** — Read-only (gmail.readInbox, youtube.search). Auto-execute, audit-logged.
- **2** — Local write (filesystem.writeFile, notes.createNote). Preview + approve.
- **3** — External send (gmail.sendEmail, whatsapp.send). Detail preview + approve.
- **4** — Delete/irreversible (filesystem.deleteFile, calendar.deleteEvent). Explicit confirm.

Tier resolution: User override (`~/.openclaw/tier-overrides.json`) > `riskTiers[action]` > `defaultRiskTier` > global default (2). See `risk-tiers.ts`.

Tools werden via LLM-native Function Calling aufgerufen (nicht String-Parsing).
Registrierung über `createOpenClawCodingTools()` in `register.ts`.

Jedes Tool braucht Verhaltens-Tests UND Security-Tests (kein eval, kein unauthorisierter fetch, kein Path Traversal).

### Scheduler / CronBridge
`scheduler.ts` delegates schedule/list/cancel to OpenClaw CronService via `CronBridge` interface (injected via `createSchedulerTool(bridge?)`). Working buffer (addProactive, buffer, clearBuffer) remains local.

### Agent Executor / LlmClient
`agent-executor.ts` runs sub-agents as isolated LLM calls via `executeAgent(task, pool, llmClient)`. LLM access injected via `LlmClient` interface (same DI pattern as `CronBridge`). Safety limits: max 50 tool calls (`MAX_STEPS_LIMIT`), 5 min timeout (`MAX_TIMEOUT_MS`), 50 KB tool result truncation. Tool allowlist enforced (only tools from `agentDef.tools`). Risk tier resolution: tool-defined `riskTiers[action]` > `defaultRiskTier` > heuristic fallback. Approval threshold per trust level: intern≥2, junior≥3, senior≥4. Loop detection via SHA-256 hash dedup.

## Tool-Caveats

- Tool-Signierung: Ed25519 — `sign-tools.ts` signiert mit libsodium, `verify.ts` prüft mit Node crypto (timingSafeEqual + crypto.verify). Private Key NUR in `.env`, Public Key in `public-key.ts`. Gateway ruft `verifyTool()` vor dem Laden auf.
- Kein fetch() in Tools außer an dokumentierte APIs (Gmail, Calendar, Search)
- Pfad-Validierung gegen Whitelist bei jedem Dateizugriff (Path Traversal Schutz)

## Tool-Signierung

```bash
npx tsx scripts/sign-tools.ts  # Keypair generieren (wenn nötig) + alle Tools signieren
```
