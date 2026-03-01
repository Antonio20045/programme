import type { DbPool } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum input tokens per agent per day. */
const DEFAULT_MAX_INPUT_TOKENS = 100_000

/** Maximum output tokens per agent per day. */
const DEFAULT_MAX_OUTPUT_TOKENS = 50_000

/** Maximum tool calls per agent per day. */
const DEFAULT_MAX_TOOL_CALLS = 100

/** Max allowed value for days/maxAgeDays parameters. */
const MAX_DAYS_PARAM = 3650

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/

function validateAgentId(agentId: string): void {
  if (typeof agentId !== 'string' || !AGENT_ID_RE.test(agentId)) {
    throw new Error('Invalid agentId: must be 2-100 lowercase alphanumeric/hyphen characters')
  }
}

function validateUserId(userId: string): void {
  if (typeof userId !== 'string' || userId.length === 0 || userId.length > 200) {
    throw new Error('Invalid userId: must be a non-empty string (max 200 chars)')
  }
}

function validatePositiveInteger(value: number, name: string, max: number = MAX_DAYS_PARAM): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`Invalid ${name}: must be an integer between 1 and ${max}`)
  }
}

function validateNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}: must be a non-negative integer`)
  }
}

function validateUsageInput(usage: UsageInput): void {
  validateNonNegativeInteger(usage.inputTokens, 'inputTokens')
  validateNonNegativeInteger(usage.outputTokens, 'outputTokens')
  validateNonNegativeInteger(usage.toolCalls, 'toolCalls')
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BudgetStatus {
  readonly allowed: boolean
  readonly today: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly toolCalls: number
  }
  readonly limits: {
    readonly maxInputTokens: number
    readonly maxOutputTokens: number
    readonly maxToolCalls: number
  }
  readonly remaining: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly toolCalls: number
  }
}

interface DailyStats {
  readonly date: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly toolCalls: number
}

interface UsageInput {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly toolCalls: number
}

// ---------------------------------------------------------------------------
// Core — Budget Check
// ---------------------------------------------------------------------------

/**
 * Checks whether an agent is within its daily budget.
 *
 * Integration point: call before executeAgent() as a guard.
 * Natural location: delegate-tool.ts (has pool, agentId, userId).
 *
 * TOCTOU caveat: the check is non-atomic with recordUsage().
 * Concurrent requests may both pass the check before either records.
 * For strict enforcement, use a single transaction with row-level locking
 * (SELECT ... FOR UPDATE) wrapping both check and record.
 */
async function checkBudget(
  pool: DbPool,
  agentId: string,
  userId: string,
): Promise<BudgetStatus> {
  validateAgentId(agentId)
  validateUserId(userId)

  const { rows } = await pool.query(
    `SELECT input_tokens, output_tokens, tool_calls
     FROM agent_budgets
     WHERE agent_id = $1 AND user_id = $2 AND budget_date = CURRENT_DATE`,
    [agentId, userId],
  )

  const row = rows[0]
  const inputTokens = row ? Number(row.input_tokens) : 0
  const outputTokens = row ? Number(row.output_tokens) : 0
  const toolCalls = row ? Number(row.tool_calls) : 0

  const allowed =
    inputTokens < DEFAULT_MAX_INPUT_TOKENS &&
    outputTokens < DEFAULT_MAX_OUTPUT_TOKENS &&
    toolCalls < DEFAULT_MAX_TOOL_CALLS

  return {
    allowed,
    today: { inputTokens, outputTokens, toolCalls },
    limits: {
      maxInputTokens: DEFAULT_MAX_INPUT_TOKENS,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
    },
    remaining: {
      inputTokens: Math.max(0, DEFAULT_MAX_INPUT_TOKENS - inputTokens),
      outputTokens: Math.max(0, DEFAULT_MAX_OUTPUT_TOKENS - outputTokens),
      toolCalls: Math.max(0, DEFAULT_MAX_TOOL_CALLS - toolCalls),
    },
  }
}

// ---------------------------------------------------------------------------
// Core — Record Usage
// ---------------------------------------------------------------------------

/**
 * Records token and tool-call usage for an agent.
 * Uses UPSERT — multiple calls on the same day accumulate.
 *
 * Integration point: call after executeAgent() with result.usage + result.toolCalls.
 * Natural location: delegate-tool.ts (has pool, agentId, userId).
 */
async function recordUsage(
  pool: DbPool,
  agentId: string,
  userId: string,
  usage: UsageInput,
): Promise<void> {
  validateAgentId(agentId)
  validateUserId(userId)
  validateUsageInput(usage)

  await pool.query(
    `INSERT INTO agent_budgets (agent_id, user_id, budget_date, input_tokens, output_tokens, tool_calls)
     VALUES ($1, $2, CURRENT_DATE, $3, $4, $5)
     ON CONFLICT (agent_id, budget_date)
     DO UPDATE SET
       input_tokens  = agent_budgets.input_tokens  + EXCLUDED.input_tokens,
       output_tokens = agent_budgets.output_tokens + EXCLUDED.output_tokens,
       tool_calls    = agent_budgets.tool_calls    + EXCLUDED.tool_calls`,
    [agentId, userId, usage.inputTokens, usage.outputTokens, usage.toolCalls],
  )
}

// ---------------------------------------------------------------------------
// Core — Daily Stats
// ---------------------------------------------------------------------------

/**
 * Returns daily usage statistics for an agent over the last N days.
 */
async function getDailyStats(
  pool: DbPool,
  agentId: string,
  userId: string,
  days: number = 7,
): Promise<readonly DailyStats[]> {
  validateAgentId(agentId)
  validateUserId(userId)
  validatePositiveInteger(days, 'days')

  const { rows } = await pool.query(
    `SELECT budget_date, input_tokens, output_tokens, tool_calls
     FROM agent_budgets
     WHERE agent_id = $1 AND user_id = $2
       AND budget_date >= CURRENT_DATE - make_interval(days => $3::int)
     ORDER BY budget_date DESC`,
    [agentId, userId, days],
  )

  return rows.map((row) => ({
    date: String(row.budget_date),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    toolCalls: Number(row.tool_calls),
  }))
}

// ---------------------------------------------------------------------------
// Core — Cleanup
// ---------------------------------------------------------------------------

/**
 * Deletes budget records older than maxAgeDays.
 * Returns number of deleted rows.
 *
 * Integration point: daily cron alongside runLifecycleCheck() + runMemoryCleanup().
 */
async function resetExpired(
  pool: DbPool,
  maxAgeDays: number = 30,
): Promise<number> {
  validatePositiveInteger(maxAgeDays, 'maxAgeDays')

  const { rows } = await pool.query(
    `DELETE FROM agent_budgets
     WHERE budget_date < CURRENT_DATE - make_interval(days => $1::int)
     RETURNING agent_id`,
    [maxAgeDays],
  )

  return rows.length
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  checkBudget,
  recordUsage,
  getDailyStats,
  resetExpired,
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_TOOL_CALLS,
}

export type { BudgetStatus, DailyStats, UsageInput }
