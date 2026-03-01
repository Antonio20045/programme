/**
 * Agent registry — CRUD operations for user-defined sub-agent definitions.
 * Storage: PostgreSQL.
 *
 * All queries use parameterized $-placeholders — zero string concatenation in SQL.
 * User isolation: every query is scoped by userId.
 */

import { randomBytes } from 'node:crypto'
import type { DbPool } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_AGENTS_PER_USER = 20

const VALID_RISK_PROFILES = ['read-only', 'write-with-approval', 'full-autonomy'] as const
const VALID_STATUSES = ['active', 'dormant', 'archived'] as const
const VALID_TRUST_LEVELS = ['intern', 'junior', 'senior'] as const

const PROMOTION_INTERN_MIN_TASKS = 20
const PROMOTION_INTERN_MIN_SUCCESS_RATE = 0.90
const PROMOTION_INTERN_MIN_AGE_DAYS = 14
const PROMOTION_JUNIOR_MIN_TASKS = 50
const PROMOTION_JUNIOR_MIN_SUCCESS_RATE = 0.95
const PROMOTION_JUNIOR_MAX_OVERRIDE_RATE = 0.10
const DEMOTION_MAX_OVERRIDE_RATE = 0.15
const DEMOTION_MIN_TASKS = 20
const MS_PER_DAY = 86_400_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RiskProfile = (typeof VALID_RISK_PROFILES)[number]
type AgentStatus = (typeof VALID_STATUSES)[number]
type TrustLevel = (typeof VALID_TRUST_LEVELS)[number]

interface TrustMetrics {
  readonly totalTasks: number
  readonly successfulTasks: number
  readonly userOverrides: number
  readonly promotedAt: string | null
}

interface AgentDefinition {
  readonly id: string
  readonly userId: string
  readonly name: string
  readonly description: string
  readonly systemPrompt: string
  readonly tools: readonly string[]
  readonly model: string
  readonly riskProfile: RiskProfile
  readonly maxSteps: number
  readonly maxTokens: number
  readonly timeoutMs: number
  readonly memoryNamespace: string
  readonly cronSchedule: string | null
  readonly status: AgentStatus
  readonly trustLevel: TrustLevel
  readonly trustMetrics: TrustMetrics
  readonly usageCount: number
  readonly createdAt: string
  readonly lastUsedAt: string
}

interface CreateAgentInput {
  readonly name: string
  readonly description?: string
  readonly systemPrompt?: string
  readonly tools?: readonly string[]
  readonly model?: string
  readonly riskProfile?: RiskProfile
  readonly maxSteps?: number
  readonly maxTokens?: number
  readonly timeoutMs?: number
  readonly cronSchedule?: string | null
}

interface UpdateAgentInput {
  readonly name?: string
  readonly description?: string
  readonly systemPrompt?: string
  readonly tools?: readonly string[]
  readonly model?: string
  readonly riskProfile?: RiskProfile
  readonly maxSteps?: number
  readonly maxTokens?: number
  readonly timeoutMs?: number
  readonly memoryNamespace?: string
  readonly cronSchedule?: string | null
}

/**
 * Internal-only update type that includes trust fields.
 * MUST NOT be exported — trust level changes go through checkAndApplyPromotion().
 */
interface InternalUpdateAgentInput extends UpdateAgentInput {
  readonly trustLevel?: TrustLevel
  readonly trustMetrics?: TrustMetrics
}

interface TrustOutcome {
  readonly success: boolean
  readonly overridden: boolean
}

interface TrustChange {
  readonly result: 'promoted' | 'demoted' | 'unchanged'
  readonly from?: TrustLevel
  readonly to?: TrustLevel
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function toKebabCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function generateAgentId(name: string): string {
  const prefix = toKebabCase(name)
  const hex = randomBytes(3).toString('hex')
  return `${prefix}-${hex}`
}

// ---------------------------------------------------------------------------
// Row conversion (pg → typed AgentDefinition)
// ---------------------------------------------------------------------------

function parseTrustMetrics(raw: unknown): TrustMetrics {
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    return {
      totalTasks: Number(obj['totalTasks'] ?? 0),
      successfulTasks: Number(obj['successfulTasks'] ?? 0),
      userOverrides: Number(obj['userOverrides'] ?? 0),
      promotedAt:
        obj['promotedAt'] === null || obj['promotedAt'] === undefined
          ? null
          : String(obj['promotedAt']),
    }
  }
  return { totalTasks: 0, successfulTasks: 0, userOverrides: 0, promotedAt: null }
}

function parseTools(raw: unknown): readonly string[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string')
  }
  return []
}

function toAgentRow(row: Record<string, unknown>): AgentDefinition {
  return {
    id: String(row['id'] ?? ''),
    userId: String(row['user_id'] ?? ''),
    name: String(row['name'] ?? ''),
    description: String(row['description'] ?? ''),
    systemPrompt: String(row['system_prompt'] ?? ''),
    tools: parseTools(row['tools']),
    model: String(row['model'] ?? 'haiku'),
    riskProfile: String(row['risk_profile'] ?? 'read-only') as RiskProfile,
    maxSteps: Number(row['max_steps'] ?? 5),
    maxTokens: Number(row['max_tokens'] ?? 4096),
    timeoutMs: Number(row['timeout_ms'] ?? 30000),
    memoryNamespace: String(row['memory_namespace'] ?? ''),
    cronSchedule:
      row['cron_schedule'] === null || row['cron_schedule'] === undefined
        ? null
        : String(row['cron_schedule']),
    status: String(row['status'] ?? 'active') as AgentStatus,
    trustLevel: String(row['trust_level'] ?? 'intern') as TrustLevel,
    trustMetrics: parseTrustMetrics(row['trust_metrics']),
    usageCount: Number(row['usage_count'] ?? 0),
    createdAt: String(row['created_at'] ?? ''),
    lastUsedAt: String(row['last_used_at'] ?? ''),
  }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const MAX_NAME_LENGTH = 100

function validateName(name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('Agent name must be a non-empty string')
  }
  const trimmed = name.trim()
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error('Agent name must be at most ' + String(MAX_NAME_LENGTH) + ' characters')
  }
  return trimmed
}

function validateRiskProfile(value: unknown): RiskProfile {
  if (!VALID_RISK_PROFILES.includes(value as RiskProfile)) {
    throw new Error(`risk_profile must be one of: ${VALID_RISK_PROFILES.join(', ')}`)
  }
  return value as RiskProfile
}

function validateStatus(value: unknown): AgentStatus {
  if (!VALID_STATUSES.includes(value as AgentStatus)) {
    throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`)
  }
  return value as AgentStatus
}

function validateTrustLevel(value: unknown): TrustLevel {
  if (!VALID_TRUST_LEVELS.includes(value as TrustLevel)) {
    throw new Error(`trust_level must be one of: ${VALID_TRUST_LEVELS.join(', ')}`)
  }
  return value as TrustLevel
}

function validatePositiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

async function createAgent(
  pool: DbPool,
  userId: string,
  input: CreateAgentInput,
): Promise<AgentDefinition> {
  const name = validateName(input.name)

  // Validate optional fields before any DB calls
  if (input.riskProfile !== undefined) validateRiskProfile(input.riskProfile)
  if (input.maxSteps !== undefined) validatePositiveInt(input.maxSteps, 'maxSteps')
  if (input.maxTokens !== undefined) validatePositiveInt(input.maxTokens, 'maxTokens')
  if (input.timeoutMs !== undefined) validatePositiveInt(input.timeoutMs, 'timeoutMs')

  // Enforce per-user limit
  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM agent_registry WHERE user_id = $1',
    [userId],
  )
  const count = Number(countRows[0]?.['count'] ?? 0)
  if (count >= MAX_AGENTS_PER_USER) {
    throw new Error('Maximum of ' + String(MAX_AGENTS_PER_USER) + ' agents per user reached')
  }

  const id = generateAgentId(name)
  const memoryNamespace = `agent-${id}`

  const { rows } = await pool.query(
    `INSERT INTO agent_registry (
       id, user_id, name, description, system_prompt, tools, model,
       risk_profile, max_steps, max_tokens, timeout_ms, memory_namespace,
       cron_schedule
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      id,
      userId,
      name,
      input.description ?? '',
      input.systemPrompt ?? '',
      JSON.stringify(input.tools ?? []),
      input.model ?? 'haiku',
      input.riskProfile ?? 'read-only',
      input.maxSteps ?? 5,
      input.maxTokens ?? 4096,
      input.timeoutMs ?? 30000,
      memoryNamespace,
      input.cronSchedule ?? null,
    ],
  )

  const row = rows[0]
  if (!row) throw new Error('Failed to create agent')
  return toAgentRow(row)
}

async function getAgent(
  pool: DbPool,
  userId: string,
  agentId: string,
): Promise<AgentDefinition | null> {
  const { rows } = await pool.query(
    'SELECT * FROM agent_registry WHERE id = $2 AND user_id = $1',
    [userId, agentId],
  )
  const row = rows[0]
  if (!row) return null
  return toAgentRow(row)
}

async function getUserAgents(
  pool: DbPool,
  userId: string,
): Promise<AgentDefinition[]> {
  const { rows } = await pool.query(
    'SELECT * FROM agent_registry WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  )
  return rows.map(toAgentRow)
}

async function getActiveAgents(
  pool: DbPool,
  userId: string,
): Promise<AgentDefinition[]> {
  const { rows } = await pool.query(
    "SELECT * FROM agent_registry WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC",
    [userId],
  )
  return rows.map(toAgentRow)
}

async function updateAgent(
  pool: DbPool,
  userId: string,
  agentId: string,
  input: InternalUpdateAgentInput,
): Promise<AgentDefinition> {
  const setClauses: string[] = []
  const values: unknown[] = [userId, agentId]
  let paramIndex = 3

  // Helper to build safe $N placeholder (string concat, not template literal)
  function nextParam(): string {
    return '$' + String(paramIndex++)
  }

  if (input.name !== undefined) {
    const name = validateName(input.name)
    setClauses.push('name = ' + nextParam())
    values.push(name)
  }
  if (input.description !== undefined) {
    setClauses.push('description = ' + nextParam())
    values.push(input.description)
  }
  if (input.systemPrompt !== undefined) {
    setClauses.push('system_prompt = ' + nextParam())
    values.push(input.systemPrompt)
  }
  if (input.tools !== undefined) {
    setClauses.push('tools = ' + nextParam())
    values.push(JSON.stringify(input.tools))
  }
  if (input.model !== undefined) {
    setClauses.push('model = ' + nextParam())
    values.push(input.model)
  }
  if (input.riskProfile !== undefined) {
    validateRiskProfile(input.riskProfile)
    setClauses.push('risk_profile = ' + nextParam())
    values.push(input.riskProfile)
  }
  if (input.maxSteps !== undefined) {
    validatePositiveInt(input.maxSteps, 'maxSteps')
    setClauses.push('max_steps = ' + nextParam())
    values.push(input.maxSteps)
  }
  if (input.maxTokens !== undefined) {
    validatePositiveInt(input.maxTokens, 'maxTokens')
    setClauses.push('max_tokens = ' + nextParam())
    values.push(input.maxTokens)
  }
  if (input.timeoutMs !== undefined) {
    validatePositiveInt(input.timeoutMs, 'timeoutMs')
    setClauses.push('timeout_ms = ' + nextParam())
    values.push(input.timeoutMs)
  }
  if (input.memoryNamespace !== undefined) {
    setClauses.push('memory_namespace = ' + nextParam())
    values.push(input.memoryNamespace)
  }
  if (input.cronSchedule !== undefined) {
    setClauses.push('cron_schedule = ' + nextParam())
    values.push(input.cronSchedule)
  }
  if (input.trustLevel !== undefined) {
    validateTrustLevel(input.trustLevel)
    setClauses.push('trust_level = ' + nextParam())
    values.push(input.trustLevel)
  }
  if (input.trustMetrics !== undefined) {
    setClauses.push('trust_metrics = ' + nextParam())
    values.push(JSON.stringify(input.trustMetrics))
  }

  if (setClauses.length === 0) {
    throw new Error('No fields to update')
  }

  const parts = ['UPDATE agent_registry SET ', setClauses.join(', '), ' WHERE id = $2 AND user_id = $1 RETURNING *']
  const sql = parts.join('')
  const { rows } = await pool.query(sql, values)

  const row = rows[0]
  if (!row) throw new Error('Agent with id ' + agentId + ' not found')
  return toAgentRow(row)
}

async function updateStatus(
  pool: DbPool,
  userId: string,
  agentId: string,
  status: AgentStatus,
): Promise<void> {
  validateStatus(status)
  const { rows } = await pool.query(
    'UPDATE agent_registry SET status = $3 WHERE id = $2 AND user_id = $1 RETURNING id',
    [userId, agentId, status],
  )
  if (rows.length === 0) throw new Error(`Agent with id ${agentId} not found`)
}

async function touchAgent(
  pool: DbPool,
  userId: string,
  agentId: string,
): Promise<void> {
  const { rows } = await pool.query(
    'UPDATE agent_registry SET last_used_at = NOW(), usage_count = usage_count + 1 WHERE id = $2 AND user_id = $1 RETURNING id',
    [userId, agentId],
  )
  if (rows.length === 0) throw new Error(`Agent with id ${agentId} not found`)
}

async function deleteAgent(
  pool: DbPool,
  userId: string,
  agentId: string,
): Promise<void> {
  const { rows } = await pool.query(
    'DELETE FROM agent_registry WHERE id = $2 AND user_id = $1 RETURNING id',
    [userId, agentId],
  )
  if (rows.length === 0) throw new Error(`Agent with id ${agentId} not found`)
}

// ---------------------------------------------------------------------------
// Trust progression
// ---------------------------------------------------------------------------

/**
 * Atomically updates trust metrics for a sub-agent after task completion.
 *
 * Integration points (JSDoc only — wiring happens in gateway integration):
 * - After `executeAgent()` → `updateTrustMetrics(success=..., overridden: false)`
 * - After `rejectApproval()` → `updateTrustMetrics(success: false, overridden: true)`
 * - After `executeApproval()` with `modifiedParams` → `updateTrustMetrics(success: true, overridden: true)`
 * - After `executeApproval()` without `modifiedParams` → `updateTrustMetrics(success: true, overridden: false)`
 * - After each call, invoke `checkAndApplyPromotion()` and notify user on changes.
 */
async function updateTrustMetrics(
  pool: DbPool,
  userId: string,
  agentId: string,
  outcome: TrustOutcome,
): Promise<TrustMetrics> {
  const successInc = outcome.success ? 1 : 0
  const overrideInc = outcome.overridden ? 1 : 0

  const sql = [
    'UPDATE agent_registry SET trust_metrics = ',
    "jsonb_set(jsonb_set(jsonb_set(trust_metrics, '{totalTasks}', (COALESCE((trust_metrics->>'totalTasks')::int, 0) + 1)::text::jsonb), ",
    "'{successfulTasks}', (COALESCE((trust_metrics->>'successfulTasks')::int, 0) + $3::int)::text::jsonb), ",
    "'{userOverrides}', (COALESCE((trust_metrics->>'userOverrides')::int, 0) + $4::int)::text::jsonb) ",
    'WHERE id = $2 AND user_id = $1 RETURNING trust_metrics',
  ].join('')

  const { rows } = await pool.query(sql, [userId, agentId, successInc, overrideInc])

  const row = rows[0]
  if (!row) throw new Error('Agent with id ' + agentId + ' not found')
  return parseTrustMetrics(row['trust_metrics'])
}

/**
 * Evaluates promotion/demotion rules and applies trust level changes.
 *
 * Demotion is checked first (overrideRate > 15% AND totalTasks >= 20):
 * - senior → junior, junior → intern, intern stays (floor)
 *
 * Promotion:
 * - intern → junior: ≥20 tasks, >90% success, agent >14 days old
 * - junior → senior: ≥50 tasks, >95% success, <10% override rate
 *
 * Note: trust_metrics only stores aggregates, no sliding window.
 * Override/success rates are lifetime rates.
 */
async function checkAndApplyPromotion(
  pool: DbPool,
  userId: string,
  agentId: string,
): Promise<TrustChange> {
  const agent = await getAgent(pool, userId, agentId)
  if (!agent) throw new Error('Agent with id ' + agentId + ' not found')

  const { totalTasks, successfulTasks, userOverrides } = agent.trustMetrics
  const currentLevel = agent.trustLevel

  const successRate = totalTasks > 0 ? successfulTasks / totalTasks : 0
  const overrideRate = totalTasks > 0 ? userOverrides / totalTasks : 0

  // --- Demotion check (takes priority) ---
  if (totalTasks >= DEMOTION_MIN_TASKS && overrideRate > DEMOTION_MAX_OVERRIDE_RATE) {
    if (currentLevel === 'senior') {
      await updateAgent(pool, userId, agentId, {
        trustLevel: 'junior',
        trustMetrics: { ...agent.trustMetrics, promotedAt: new Date().toISOString() },
      })
      return { result: 'demoted', from: 'senior', to: 'junior' }
    }
    if (currentLevel === 'junior') {
      await updateAgent(pool, userId, agentId, {
        trustLevel: 'intern',
        trustMetrics: { ...agent.trustMetrics, promotedAt: new Date().toISOString() },
      })
      return { result: 'demoted', from: 'junior', to: 'intern' }
    }
    // intern cannot go lower
    return { result: 'unchanged' }
  }

  // --- Promotion check ---
  const agentAgeMs = Date.now() - new Date(agent.createdAt).getTime()
  const agentAgeDays = agentAgeMs / MS_PER_DAY

  if (
    currentLevel === 'intern' &&
    totalTasks >= PROMOTION_INTERN_MIN_TASKS &&
    successRate > PROMOTION_INTERN_MIN_SUCCESS_RATE &&
    agentAgeDays > PROMOTION_INTERN_MIN_AGE_DAYS
  ) {
    await updateAgent(pool, userId, agentId, {
      trustLevel: 'junior',
      trustMetrics: { ...agent.trustMetrics, promotedAt: new Date().toISOString() },
    })
    return { result: 'promoted', from: 'intern', to: 'junior' }
  }

  if (
    currentLevel === 'junior' &&
    totalTasks >= PROMOTION_JUNIOR_MIN_TASKS &&
    successRate > PROMOTION_JUNIOR_MIN_SUCCESS_RATE &&
    overrideRate < PROMOTION_JUNIOR_MAX_OVERRIDE_RATE
  ) {
    await updateAgent(pool, userId, agentId, {
      trustLevel: 'senior',
      trustMetrics: { ...agent.trustMetrics, promotedAt: new Date().toISOString() },
    })
    return { result: 'promoted', from: 'junior', to: 'senior' }
  }

  return { result: 'unchanged' }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  createAgent,
  getAgent,
  getUserAgents,
  getActiveAgents,
  updateAgent,
  updateStatus,
  touchAgent,
  deleteAgent,
  updateTrustMetrics,
  checkAndApplyPromotion,
  generateAgentId,
  toKebabCase,
  MAX_AGENTS_PER_USER,
  DEMOTION_MIN_TASKS,
}
export type {
  AgentDefinition,
  CreateAgentInput,
  UpdateAgentInput,
  TrustMetrics,
  TrustOutcome,
  TrustChange,
  RiskProfile,
  AgentStatus,
  TrustLevel,
}
