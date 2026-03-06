/**
 * Agent Telemetry — minimal event-tracking for sub-agent execution.
 *
 * All public functions are fire-and-forget-safe: they catch internally and never throw.
 * No eval. No unauthorized fetch.
 */

import type { DbPool } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventType =
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'budget.exceeded'
  | 'trust.changed'

interface AgentEventMetadata {
  readonly [key: string]: string | number | boolean | null | undefined
}

interface AgentStats {
  readonly totalEvents: number
  readonly started: number
  readonly completed: number
  readonly failed: number
  readonly budgetExceeded: number
  readonly trustChanged: number
}

// ---------------------------------------------------------------------------
// Core — Emit Event
// ---------------------------------------------------------------------------

async function emitEvent(
  pool: DbPool,
  userId: string,
  agentId: string,
  eventType: EventType,
  metadata: AgentEventMetadata = {},
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO agent_events (user_id, agent_id, event_type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [userId, agentId, eventType, JSON.stringify(metadata)],
    )
  } catch {
    // Silently fail — telemetry must never break execution
  }
}

// ---------------------------------------------------------------------------
// Typed Convenience Functions
// ---------------------------------------------------------------------------

function trackAgentStarted(
  pool: DbPool,
  userId: string,
  agentId: string,
  task: string,
): void {
  void emitEvent(pool, userId, agentId, 'agent.started', {
    task: task.slice(0, 500),
  })
}

function trackAgentCompleted(
  pool: DbPool,
  userId: string,
  agentId: string,
  toolCalls: number,
  inputTokens: number,
  outputTokens: number,
): void {
  void emitEvent(pool, userId, agentId, 'agent.completed', {
    toolCalls,
    inputTokens,
    outputTokens,
  })
}

function trackAgentFailed(
  pool: DbPool,
  userId: string,
  agentId: string,
  reason: string,
): void {
  void emitEvent(pool, userId, agentId, 'agent.failed', {
    reason: reason.slice(0, 500),
  })
}

function trackBudgetExceeded(
  pool: DbPool,
  userId: string,
  agentId: string,
): void {
  void emitEvent(pool, userId, agentId, 'budget.exceeded')
}

function trackTrustChanged(
  pool: DbPool,
  userId: string,
  agentId: string,
  changeResult: string,
  from?: string,
  to?: string,
): void {
  void emitEvent(pool, userId, agentId, 'trust.changed', {
    changeResult,
    from: from ?? null,
    to: to ?? null,
  })
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

async function getAgentStats(
  pool: DbPool,
  userId: string,
  agentId: string,
  days: number = 30,
): Promise<AgentStats> {
  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE event_type = 'agent.started') AS started,
         COUNT(*) FILTER (WHERE event_type = 'agent.completed') AS completed,
         COUNT(*) FILTER (WHERE event_type = 'agent.failed') AS failed,
         COUNT(*) FILTER (WHERE event_type = 'budget.exceeded') AS budget_exceeded,
         COUNT(*) FILTER (WHERE event_type = 'trust.changed') AS trust_changed
       FROM agent_events
       WHERE user_id = $1 AND agent_id = $2
         AND created_at >= NOW() - make_interval(days => $3::int)`,
      [userId, agentId, days],
    )

    const row = rows[0]
    return {
      totalEvents: Number(row?.total ?? 0),
      started: Number(row?.started ?? 0),
      completed: Number(row?.completed ?? 0),
      failed: Number(row?.failed ?? 0),
      budgetExceeded: Number(row?.budget_exceeded ?? 0),
      trustChanged: Number(row?.trust_changed ?? 0),
    }
  } catch {
    return { totalEvents: 0, started: 0, completed: 0, failed: 0, budgetExceeded: 0, trustChanged: 0 }
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanupOldEvents(
  pool: DbPool,
  maxAgeDays: number = 90,
): Promise<number> {
  try {
    const { rows } = await pool.query(
      `DELETE FROM agent_events
       WHERE created_at < NOW() - make_interval(days => $1::int)
       RETURNING id`,
      [maxAgeDays],
    )
    return rows.length
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  emitEvent,
  trackAgentStarted,
  trackAgentCompleted,
  trackAgentFailed,
  trackBudgetExceeded,
  trackTrustChanged,
  getAgentStats,
  cleanupOldEvents,
}

export type { EventType, AgentEventMetadata, AgentStats }
