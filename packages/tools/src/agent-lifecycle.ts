import {
  getUserAgents,
  updateStatus,
  deleteAgent,
  touchAgent,
  getAgent,
  updateAgent,
} from './agent-registry'
import type { Retention } from './agent-registry'
import {
  deleteNamespace,
  getByCategory,
  deleteKey,
  cleanupExpired,
  cleanupStaleCache,
} from './agent-memory'
import type { DbPool } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000

/** Days without usage before an active agent becomes dormant. */
const DORMANT_THRESHOLD_DAYS = 30

/** Days without usage before a dormant agent is archived. */
const ARCHIVED_THRESHOLD_DAYS = 90

/** Days without usage before an archived agent is permanently deleted. */
const DELETED_THRESHOLD_DAYS = 180

/** Memory categories wiped on archival (everything except 'preference'). */
const NON_PREFERENCE_CATEGORIES = ['learned', 'state', 'cache', 'general'] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LifecycleReport {
  readonly dormant: readonly string[]
  readonly archived: readonly string[]
  readonly deleted: readonly string[]
  readonly notifications: readonly string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysSinceLastUsed(lastUsedAt: string): number {
  return Math.floor((Date.now() - new Date(lastUsedAt).getTime()) / MS_PER_DAY)
}

// ---------------------------------------------------------------------------
// Post-Execution — Retention-based cleanup after agent run
// ---------------------------------------------------------------------------

interface PostExecutionResult {
  readonly action: 'none' | 'dormant' | 'deleted'
  readonly message?: string
}

/**
 * Called after a sub-agent completes a task. Applies retention policy:
 * - ephemeral + success → delete agent and memory
 * - seasonal + success → set agent to dormant
 * - persistent → no action
 *
 * Only acts on successful executions — failed runs leave the agent unchanged.
 */
async function handlePostExecution(
  pool: DbPool,
  userId: string,
  agentId: string,
  agentName: string,
  retention: Retention,
  resultStatus: string,
): Promise<PostExecutionResult> {
  if (resultStatus !== 'success') {
    return { action: 'none' }
  }

  if (retention === 'ephemeral') {
    await deleteNamespace(pool, agentId, userId)
    await deleteAgent(pool, userId, agentId)
    return {
      action: 'deleted',
      message: 'Einmal-Agent "' + agentName + '" wurde nach Erledigung entfernt.',
    }
  }

  if (retention === 'seasonal') {
    await updateStatus(pool, userId, agentId, 'dormant')
    return {
      action: 'dormant',
      message: 'Agent "' + agentName + '" wird bis zur nächsten Nutzung pausiert.',
    }
  }

  return { action: 'none' }
}

// ---------------------------------------------------------------------------
// Core — Lifecycle Check
// ---------------------------------------------------------------------------

/**
 * Runs a full lifecycle check for all agents of a user.
 *
 * Processing order (highest threshold first) ensures that an agent unused for
 * 185 days is deleted directly — it never passes through dormant/archived.
 */
async function runLifecycleCheck(
  pool: DbPool,
  userId: string,
): Promise<LifecycleReport> {
  const agents = await getUserAgents(pool, userId)

  const dormant: string[] = []
  const archived: string[] = []
  const deleted: string[] = []
  const notifications: string[] = []

  for (const agent of agents) {
    // Ephemeral agents are handled by post-execution — skip lifecycle
    if (agent.retention === 'ephemeral') continue

    const days = daysSinceLastUsed(agent.lastUsedAt)

    // Seasonal agents: only dormant threshold, no archive/delete
    if (agent.retention === 'seasonal') {
      if (days > DORMANT_THRESHOLD_DAYS && agent.status === 'active') {
        await updateStatus(pool, userId, agent.id, 'dormant')

        if (agent.cronSchedule !== null) {
          await updateAgent(pool, userId, agent.id, { cronSchedule: null })
        }

        dormant.push(agent.id)
      }
      continue
    }

    // Persistent agents: full lifecycle (unchanged behavior)

    // --- Step 3: DELETE (> 180 days, any status) -------------------------
    if (days > DELETED_THRESHOLD_DAYS) {
      await deleteNamespace(pool, agent.id, userId)
      await deleteAgent(pool, userId, agent.id)
      deleted.push(agent.id)
      notifications.push(`Agent ${agent.name} wurde entfernt.`)
      continue
    }

    // --- Step 2: ARCHIVE (> 90 days, active or dormant) ------------------
    if (days > ARCHIVED_THRESHOLD_DAYS && agent.status !== 'archived') {
      await updateStatus(pool, userId, agent.id, 'archived')

      if (agent.cronSchedule !== null) {
        await updateAgent(pool, userId, agent.id, { cronSchedule: null })
      }

      for (const category of NON_PREFERENCE_CATEGORIES) {
        const entries = await getByCategory(pool, agent.id, userId, category)
        for (const entry of entries) {
          await deleteKey(pool, agent.id, userId, entry.key)
        }
      }

      archived.push(agent.id)
      notifications.push(`Agent ${agent.name} archiviert. Reaktivierung möglich.`)
      continue
    }

    // --- Step 1: DORMANT (> 30 days, active only) ------------------------
    if (days > DORMANT_THRESHOLD_DAYS && agent.status === 'active') {
      await updateStatus(pool, userId, agent.id, 'dormant')

      if (agent.cronSchedule !== null) {
        await updateAgent(pool, userId, agent.id, { cronSchedule: null })
      }

      dormant.push(agent.id)
      continue
    }
  }

  return { dormant, archived, deleted, notifications }
}

// ---------------------------------------------------------------------------
// Reactivation
// ---------------------------------------------------------------------------

/**
 * Reactivates a dormant or archived agent.
 * Throws if the agent is already active or does not exist.
 */
async function reactivateAgent(
  pool: DbPool,
  userId: string,
  agentId: string,
): Promise<void> {
  const agent = await getAgent(pool, userId, agentId)

  if (!agent) {
    throw new Error('Agent not found')
  }

  if (agent.status === 'active') {
    throw new Error('Agent is already active')
  }

  await updateStatus(pool, userId, agentId, 'active')
  await touchAgent(pool, userId, agentId)
}

// ---------------------------------------------------------------------------
// Memory Cleanup
// ---------------------------------------------------------------------------

/**
 * Runs global memory maintenance: TTL-expired entries + stale cache (> 7 days).
 * Returns total number of deleted entries.
 */
async function runMemoryCleanup(pool: DbPool): Promise<number> {
  const expired = await cleanupExpired(pool)
  const stale = await cleanupStaleCache(pool, 7)
  return expired + stale
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  runLifecycleCheck,
  reactivateAgent,
  runMemoryCleanup,
  handlePostExecution,
  DORMANT_THRESHOLD_DAYS,
  ARCHIVED_THRESHOLD_DAYS,
  DELETED_THRESHOLD_DAYS,
}

export type { LifecycleReport, PostExecutionResult }
