/**
 * Agent Cron — lightweight cron ticker for sub-agent scheduled execution.
 *
 * Own ticker instead of CronService because sub-agents need executeAgent()
 * with budget-check, retention-handling, and notifications — a different
 * execution path than CronService's agentTurn pipeline.
 *
 * No external dependencies. 60-second interval. UTC-based matching.
 */

import { getAgent, getScheduledAgents, getAllUserIds, updateTrustMetrics, checkAndApplyPromotion, deriveTrustOutcome } from './agent-registry'
import { executeAgent } from './agent-executor'
import type { LlmClient, AgentResult } from './agent-executor'
import { checkBudget, recordUsage } from './budget-controller'
import { storeProposal } from './pending-approvals'
import { cleanupExpired as cleanupExpiredProposals } from './pending-approvals'
import { handlePostExecution } from './agent-lifecycle'
import { runLifecycleCheck, runMemoryCleanup } from './agent-lifecycle'
import { resetExpired as resetExpiredBudgets } from './budget-controller'
import { trackAgentStarted, trackAgentCompleted, trackAgentFailed, trackBudgetExceeded, trackTrustChanged, cleanupOldEvents } from './agent-telemetry'
import type { DbPool } from './types'

// ---------------------------------------------------------------------------
// Cron Expression Evaluator
// ---------------------------------------------------------------------------

/** Checks if a single cron field matches a given value. */
function fieldMatches(field: string, value: number): boolean {
  if (field === '*') return true

  // Step pattern: */N
  const stepAll = field.match(/^\*\/(\d+)$/)
  if (stepAll) {
    return value % Number(stepAll[1]) === 0
  }

  // Comma-separated list (may contain ranges or range-steps)
  const parts = field.split(',')
  for (const part of parts) {
    // Range with step: N-M/S
    const rangeStep = part.match(/^(\d+)-(\d+)\/(\d+)$/)
    if (rangeStep) {
      const start = Number(rangeStep[1])
      const end = Number(rangeStep[2])
      const step = Number(rangeStep[3])
      if (value >= start && value <= end && (value - start) % step === 0) return true
      continue
    }

    // Range: N-M
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (value >= start && value <= end) return true
      continue
    }

    // Single value
    if (Number(part) === value) return true
  }

  return false
}

/**
 * Checks if a 5-field cron expression matches a given time (UTC).
 */
function cronMatchesNow(expr: string, now: Date): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const minute = now.getUTCMinutes()
  const hour = now.getUTCHours()
  const dom = now.getUTCDate()
  const month = now.getUTCMonth() + 1 // 1-based
  const dow = now.getUTCDay() // 0 = Sunday

  return (
    fieldMatches(parts[0]!, minute) &&
    fieldMatches(parts[1]!, hour) &&
    fieldMatches(parts[2]!, dom) &&
    fieldMatches(parts[3]!, month) &&
    fieldMatches(parts[4]!, dow)
  )
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentCronDeps {
  readonly pool: DbPool
  readonly llmClient: LlmClient
  readonly onResult: (userId: string, agentId: string, result: AgentResult) => Promise<unknown>
}

interface RegisteredJob {
  readonly userId: string
  readonly cronSchedule: string
  lastFiredMinute: number
}

// ---------------------------------------------------------------------------
// Module State (singleton)
// ---------------------------------------------------------------------------

let deps: AgentCronDeps | null = null
const jobs = new Map<string, RegisteredJob>()
let ticker: ReturnType<typeof setInterval> | null = null

const TICK_INTERVAL_MS = 60_000

// Lifecycle cron: daily at 03:00 UTC
const LIFECYCLE_CRON_ID = '__lifecycle__'
const LIFECYCLE_CRON_EXPR = '0 3 * * *'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the cron system. Must be called once at startup.
 */
function initAgentCron(cronDeps: AgentCronDeps): void {
  deps = cronDeps
  startTicker()
}

/**
 * Stop the cron system and clear all jobs.
 */
function stopAgentCron(): void {
  if (ticker !== null) {
    clearInterval(ticker)
    ticker = null
  }
  jobs.clear()
  deps = null
}

/**
 * Register a single agent cron job.
 */
function registerAgentCronJob(agentId: string, userId: string, cronSchedule: string): void {
  jobs.set(agentId, {
    userId,
    cronSchedule,
    lastFiredMinute: 0,
  })
}

/**
 * Unregister an agent cron job.
 */
function unregisterAgentCronJob(agentId: string): void {
  jobs.delete(agentId)
}

/**
 * Load all scheduled agents from DB and register their cron jobs.
 * Returns the number of registered jobs.
 */
async function registerAllAgentCronJobs(): Promise<number> {
  if (!deps) throw new Error('Agent cron not initialized')

  const agents = await getScheduledAgents(deps.pool)
  for (const agent of agents) {
    if (agent.cronSchedule) {
      registerAgentCronJob(agent.id, agent.userId, agent.cronSchedule)
    }
  }
  return agents.length
}

/**
 * Register the daily lifecycle maintenance cron (03:00 UTC).
 */
function registerLifecycleCron(): void {
  jobs.set(LIFECYCLE_CRON_ID, {
    userId: '',
    cronSchedule: LIFECYCLE_CRON_EXPR,
    lastFiredMinute: 0,
  })
}

// ---------------------------------------------------------------------------
// Internal — Ticker
// ---------------------------------------------------------------------------

function startTicker(): void {
  if (ticker !== null) return
  ticker = setInterval(() => {
    void tick()
  }, TICK_INTERVAL_MS)
  // Don't block process exit
  if (typeof ticker === 'object' && 'unref' in ticker) {
    ticker.unref()
  }
}

/**
 * Main tick: check all registered jobs against current time.
 * Awaits all triggered jobs before returning (important for testability
 * and ensuring completion before next tick).
 */
async function tick(): Promise<void> {
  const now = new Date()
  const currentMinute = Math.floor(now.getTime() / 60_000)

  const pending: Promise<void>[] = []

  for (const [jobId, job] of jobs) {
    // Anti-double-fire: skip if already fired this minute
    if (currentMinute <= job.lastFiredMinute) continue

    if (!cronMatchesNow(job.cronSchedule, now)) continue

    // Mark as fired before async execution
    job.lastFiredMinute = currentMinute

    if (jobId === LIFECYCLE_CRON_ID) {
      pending.push(executeLifecycleJob())
    } else {
      pending.push(executeAgentJob(jobId, job.userId))
    }
  }

  await Promise.allSettled(pending)
}

// ---------------------------------------------------------------------------
// Internal — Agent Job Execution
// ---------------------------------------------------------------------------

async function executeAgentJob(agentId: string, userId: string): Promise<void> {
  if (!deps) return

  try {
    // 1. Check agent still exists and is active
    const agent = await getAgent(deps.pool, userId, agentId)
    if (!agent || agent.status !== 'active') {
      unregisterAgentCronJob(agentId)
      return
    }

    // 2. Check budget
    const budget = await checkBudget(deps.pool, agentId, userId)
    if (!budget.allowed) {
      trackBudgetExceeded(deps.pool, userId, agentId)
      return
    }

    // 3. Execute agent — use cronTask if available, fallback to description
    const task = agent.cronTask ?? agent.description
    trackAgentStarted(deps.pool, userId, agentId, task)
    const result = await executeAgent(
      { userId, agentId, task, timeout: agent.timeoutMs },
      deps.pool,
      deps.llmClient,
    )

    // 4. Record usage
    await recordUsage(deps.pool, agentId, userId, {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      toolCalls: result.toolCalls,
    })

    // 5. Trust metrics
    const trustOutcome = deriveTrustOutcome(result.status)
    if (trustOutcome) {
      try {
        await updateTrustMetrics(deps.pool, userId, agentId, trustOutcome)
        const trustChange = await checkAndApplyPromotion(deps.pool, userId, agentId)
        if (trustChange.result !== 'unchanged') {
          trackTrustChanged(deps.pool, userId, agentId, trustChange.result, trustChange.from, trustChange.to)
        }
      } catch {
        // Trust-metric errors must not crash the cron job
      }
    }

    // 6. Telemetry
    if (result.status === 'success' || result.status === 'partial') {
      trackAgentCompleted(deps.pool, userId, agentId, result.toolCalls, result.usage.inputTokens, result.usage.outputTokens)
    } else if (result.status === 'failure') {
      trackAgentFailed(deps.pool, userId, agentId, result.reason ?? 'unknown')
    }

    // 7. Store proposals if needs-approval
    if (result.status === 'needs-approval' && result.pendingActions.length > 0) {
      for (const action of result.pendingActions) {
        storeProposal(action, agentId)
      }
    }

    // 8. Handle retention (ephemeral delete, seasonal dormant)
    const postResult = await handlePostExecution(
      deps.pool, userId, agentId, agent.name, agent.retention, result.status,
    )
    if (postResult.action !== 'none') {
      unregisterAgentCronJob(agentId)
    }

    // 9. Notify user
    await deps.onResult(userId, agentId, result)
  } catch {
    // Silently fail — cron jobs must not crash the ticker
  }
}

// ---------------------------------------------------------------------------
// Internal — Lifecycle Job Execution (daily 03:00 UTC)
// ---------------------------------------------------------------------------

async function executeLifecycleJob(): Promise<void> {
  if (!deps) return

  try {
    // 1. Run lifecycle check for all users
    const userIds = await getAllUserIds(deps.pool)
    for (const userId of userIds) {
      const report = await runLifecycleCheck(deps.pool, userId)
      // Unregister cron jobs for affected agents
      for (const agentId of report.dormant) unregisterAgentCronJob(agentId)
      for (const agentId of report.archived) unregisterAgentCronJob(agentId)
      for (const agentId of report.deleted) unregisterAgentCronJob(agentId)
    }

    // 2. Global memory cleanup
    await runMemoryCleanup(deps.pool)

    // 3. Budget cleanup
    await resetExpiredBudgets(deps.pool)

    // 4. Telemetry cleanup
    await cleanupOldEvents(deps.pool, 90)

    // 5. Pending approvals cleanup
    cleanupExpiredProposals()
  } catch {
    // Silently fail — lifecycle errors must not crash the ticker
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  initAgentCron,
  stopAgentCron,
  registerAgentCronJob,
  unregisterAgentCronJob,
  registerAllAgentCronJobs,
  registerLifecycleCron,
  // Exported for testing
  fieldMatches,
  cronMatchesNow,
  tick,
}

export type { AgentCronDeps, RegisteredJob }

// Test-only: access to module state
export const _testOnly = {
  getJobs: () => jobs,
  getDeps: () => deps,
}
