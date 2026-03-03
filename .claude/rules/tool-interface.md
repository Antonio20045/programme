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

### Delegate Tool
`delegate-tool.ts` wraps `executeAgent()` as `ExtendedAgentTool` via factory `createDelegateTool(userId, pool, llmClient)`. Single-action tool (no `action` parameter). Parameters: `agentId` (kebab-case, max 100 chars), `task` (max 10K), `context` (optional, max 5K). Auto-reactivation: dormant seasonal agents are automatically reactivated on delegation (`reactivateAgent()` + re-fetch). Post-execution: calls `handlePostExecution()` for retention-based cleanup (ephemeral→delete, seasonal→dormant), unregisters cron jobs on status change. Maps all 4 result statuses to structured JSON with optional `retentionNote`. Sanitized error handling — no internal details leaked. `defaultRiskTier: 2`. Agent list for LLM comes via system prompt (not tool description).

### Orchestrator Classifier
`orchestrator-classifier.ts` classifies messages BEFORE the LLM call — pure rule-based, no LLM invocation. `classify(message, userId, pool) → ClassificationResult` with complexity (trivial/simple/moderate/complex), category, matchedAgents, modelTier (haiku/sonnet/opus), parallelExecution, responseMode (action/answer/conversation). Uses `getActiveAgents` (registry) for agent keyword matching, `trackRequest` (pattern-tracker) fire-and-forget. Heuristics mirrored from `gateway/src/model-router.ts` (keep in sync): `hasMultipleSubTasks`, `requestsAnalysis`, `isCodingTask`, `requiresMultiToolCoordination`. Trivial detection: short messages (≤30 chars) matching greeting/thanks/yes-no patterns. Model tier: /opus → opus, 2+ criteria → sonnet, default haiku. Response mode: `determineResponseMode(message)` — DE+EN regex heuristics for intent (imperative verbs → action, factual questions → answer, opinion/chitchat → conversation, default action). Override: agent match or criteria ≥ 1 → action. Trivial → conversation. Gateway injects mode-specific system-prompt instruction (action: immediate tool calls, answer: max 2-3 sentences, conversation: no instruction). Output monitor: `monitorResponseMode()` in `output-monitor.ts` logs violations (action >150 chars before tool call, answer >250 chars).

### Pending-Approval Store
`pending-approvals.ts` holds `ActionProposal`s from sub-agents between creation and user decision (approve/reject). In-memory `Map<proposalId, StoredProposal>` — ephemeral (no DB). Functions: `storeProposal(proposal, agentId, ttlMs?)`, `getProposal(id)`, `removeProposal(id)`, `executeApproval(id, modifiedParams?)` (resolves tool via `getTool()` and executes), `rejectApproval(id)` (returns `StoredProposal` for trust-metric updates), `cleanupExpired()`. Safety: TTL default 10 min, max 1 hour. Store cap 1000 entries with auto-eviction. Sanitized error messages (no input reflection). Delete-before-execute prevents double-execution. Note: `modifiedParams` bypasses risk-tier re-evaluation — to be addressed during gateway integration.

### Agent Lifecycle Manager
`agent-lifecycle.ts` — pure utility module (no Tool interface), called as daily cron job. Retention-aware: ephemeral agents skipped by lifecycle (handled by post-execution), seasonal agents only dormant threshold (no archive/delete), persistent agents full lifecycle. `handlePostExecution(pool, userId, agentId, name, retention, status) → PostExecutionResult` — after agent run: ephemeral+success→delete (memory+agent), seasonal+success→dormant, persistent→no-op. Only acts on success. `runLifecycleCheck(pool, userId) → LifecycleReport` with cascading thresholds based on `lastUsedAt`: persistent: >180d→delete, >90d→archive, >30d→dormant. Seasonal: >30d→dormant only. `reactivateAgent(pool, userId, agentId)` — dormant/archived → active + `touchAgent`. `runMemoryCleanup(pool) → number` — global `cleanupExpired` + `cleanupStaleCache(7)`. No own DB migration.

### Agent Factory
`agent-factory.ts` — `createAgentFactoryTool(userId, pool)` factory. Single-action tool (no `action` parameter). Parameters: `name` (1-50 chars, alphanumeric+spaces+hyphens+umlauts, case-insensitive duplicate check), `purpose` (1-2000 chars, becomes system prompt core), `tools` (1-10 entries, deduplicated, each must exist in registry), `schedule` (optional 5-field cron, min 15 min interval, semantic range validation), `model` (`haiku`|`sonnet` only, no opus), `retention` (`persistent`|`seasonal`|`ephemeral`, heuristic fallback: scheduled→persistent, unscheduled→ephemeral), `cronTask` (required when schedule set, max 2000 chars, specific task for each cron run). Derives `riskProfile` via `getToolRiskTier()` — all tools ≤ tier 1 → `read-only`, any ≥ 2 → `write-with-approval`. Builds German system prompt. Sets `maxSteps`: 5 (haiku) / 10 (sonnet), `maxTokens: 4096`, `timeoutMs: 30000`. Registers cron job via `registerAgentCronJob()` for scheduled agents. `trustLevel` always `intern` (registry default). `requiresConfirmation: true`, `defaultRiskTier: 2`. Sanitized error handling.

### Agent Cron
`agent-cron.ts` — lightweight cron ticker for sub-agent scheduled execution. Own ticker instead of CronService because sub-agents need `executeAgent()` with budget-check, retention-handling, and notifications. 60-second interval, UTC-based matching. Singleton module state. `initAgentCron(deps: {pool, llmClient, onResult})` starts ticker. `stopAgentCron()` clears all. `registerAgentCronJob(agentId, userId, cronSchedule)` / `unregisterAgentCronJob(agentId)` manage individual jobs. `registerAllAgentCronJobs()` loads from DB at startup. `registerLifecycleCron()` registers daily 03:00 UTC lifecycle job. Anti-double-fire via `lastFiredMinute` per job. Agent job flow: getAgent → checkBudget → executeAgent → recordUsage → storeProposals (if needs-approval) → handlePostExecution → onResult. Lifecycle job: runLifecycleCheck (all users) → unregister affected cron jobs → runMemoryCleanup → resetExpiredBudgets → cleanupExpiredProposals. Silent error handling (cron must not crash ticker). No DB migration (uses existing tables).

### Budget Controller
`budget-controller.ts` — pure utility module (no Tool interface), called as pre/post guard around `executeAgent()`. `checkBudget(pool, agentId, userId) → BudgetStatus` with `allowed` flag, `today` usage, `limits`, `remaining`. Defaults: 100K input/day, 50K output/day, 100 tool-calls/day. `recordUsage(pool, agentId, userId, usage)` — additive UPSERT via `ON CONFLICT(agent_id, budget_date)`. `getDailyStats(pool, agentId, userId, days=7)` — historical stats. `resetExpired(pool, maxAgeDays=30)` — global cron cleanup. All inputs validated (agentId: kebab-case regex, userId: non-empty, usage: non-negative int, days: positive int 1-3650). SQL uses `make_interval(days => $N::int)`. TOCTOU between check/record documented — for strict enforcement wrap in transaction with `SELECT ... FOR UPDATE`. Migration: 007.

## Tool-Caveats

- Tool-Signierung: Ed25519 — `sign-tools.ts` signiert mit libsodium, `verify.ts` prüft mit Node crypto (timingSafeEqual + crypto.verify). Private Key NUR in `.env`, Public Key in `public-key.ts`. Gateway ruft `verifyTool()` vor dem Laden auf.
- Kein fetch() in Tools außer an dokumentierte APIs (Gmail, Calendar, Search)
- Pfad-Validierung gegen Whitelist bei jedem Dateizugriff (Path Traversal Schutz)

## Tool-Signierung

```bash
npx tsx scripts/sign-tools.ts  # Keypair generieren (wenn nötig) + alle Tools signieren
```
