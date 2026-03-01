/**
 * Pattern Tracker — detects repeated user requests in the same category
 * and suggests creating a specialized sub-agent.
 *
 * Standalone utility (not an AgentTool). Consumed by the gateway request pipeline.
 * All queries use parameterized $-placeholders — zero string concatenation in SQL.
 */

import type { DbPool } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PATTERNS_PER_USER = 200
const PATTERN_THRESHOLD = 3
const PATTERN_WINDOW_DAYS = 14
const SUGGESTION_COOLDOWN_DAYS = 30

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PatternSuggestion {
  category: string
  queryCount: number
  recentExamples: string[]
}

// ---------------------------------------------------------------------------
// trackRequest — INSERT new pattern + prune oldest beyond limit
// ---------------------------------------------------------------------------

async function trackRequest(
  pool: DbPool, userId: string, category: string, queryText: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO request_patterns (user_id, category, query_text)
     VALUES ($1, $2, $3)`,
    [userId, category, queryText],
  )

  await pool.query(
    `DELETE FROM request_patterns
     WHERE user_id = $1
       AND id NOT IN (
         SELECT id FROM request_patterns
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       )`,
    [userId, MAX_PATTERNS_PER_USER],
  )
}

// ---------------------------------------------------------------------------
// checkForPattern — sequential queries with early-exit
// ---------------------------------------------------------------------------

async function checkForPattern(
  pool: DbPool, userId: string, category: string,
): Promise<PatternSuggestion | null> {
  // 1) Count requests in window
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS cnt
     FROM request_patterns
     WHERE user_id = $1 AND category = $2
       AND created_at > NOW() - ($3 || ' days')::INTERVAL`,
    [userId, category, PATTERN_WINDOW_DAYS],
  )
  const count = Number(countResult.rows[0]?.['cnt'] ?? 0)
  if (count < PATTERN_THRESHOLD) return null

  // 2) Check if active agent already handles this category
  try {
    const agentResult = await pool.query(
      `SELECT id FROM agent_registry
       WHERE user_id = $1 AND status = 'active'
         AND description ILIKE '%' || $2 || '%'`,
      [userId, category],
    )
    if (agentResult.rows.length > 0) return null
  } catch {
    // agent_registry table may not exist yet — continue
  }

  // 3) Check suggestion cooldown
  const cooldownResult = await pool.query(
    `SELECT id FROM pattern_suggestions
     WHERE user_id = $1 AND category = $2
       AND suggested_at > NOW() - ($3 || ' days')::INTERVAL`,
    [userId, category, SUGGESTION_COOLDOWN_DAYS],
  )
  if (cooldownResult.rows.length > 0) return null

  // 4) All conditions met — fetch recent examples and upsert suggestion
  const examplesResult = await pool.query(
    `SELECT query_text FROM request_patterns
     WHERE user_id = $1 AND category = $2
     ORDER BY created_at DESC
     LIMIT 3`,
    [userId, category],
  )
  const recentExamples = examplesResult.rows.map(
    (row) => String(row['query_text'] ?? ''),
  )

  await pool.query(
    `INSERT INTO pattern_suggestions (user_id, category)
     VALUES ($1, $2)
     ON CONFLICT (user_id, category)
     DO UPDATE SET suggested_at = NOW(), dismissed = FALSE`,
    [userId, category],
  )

  return { category, queryCount: count, recentExamples }
}

// ---------------------------------------------------------------------------
// dismissSuggestion
// ---------------------------------------------------------------------------

async function dismissSuggestion(
  pool: DbPool, userId: string, category: string,
): Promise<void> {
  await pool.query(
    `UPDATE pattern_suggestions
     SET dismissed = TRUE, suggested_at = NOW()
     WHERE user_id = $1 AND category = $2`,
    [userId, category],
  )
}

// ---------------------------------------------------------------------------
// markCreated
// ---------------------------------------------------------------------------

async function markCreated(
  pool: DbPool, userId: string, category: string, agentId: string,
): Promise<void> {
  await pool.query(
    `UPDATE pattern_suggestions
     SET created_agent_id = $3
     WHERE user_id = $1 AND category = $2`,
    [userId, category, agentId],
  )
}

// ---------------------------------------------------------------------------
// cleanupOld — remove patterns older than maxAgeDays
// ---------------------------------------------------------------------------

/**
 * Deletes request_patterns older than `maxAgeDays` across ALL users.
 *
 * SECURITY: This is a global maintenance function — it MUST only be called
 * from admin/cron context, NEVER from a user-facing request handler.
 * Unlike all other functions in this module, it is intentionally NOT scoped
 * by user_id.
 */
async function cleanupOld(
  pool: DbPool, maxAgeDays: number,
): Promise<number> {
  const { rows } = await pool.query(
    `DELETE FROM request_patterns
     WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
     RETURNING id`,
    [maxAgeDays],
  )
  return rows.length
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  trackRequest,
  checkForPattern,
  dismissSuggestion,
  markCreated,
  cleanupOld,
}
export type { PatternSuggestion }
