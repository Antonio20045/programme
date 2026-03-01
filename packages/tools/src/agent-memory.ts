/**
 * Agent Memory — isolated per-agent, per-user key-value store.
 * Storage: PostgreSQL (JSONB values). Each agent sees only its own namespace.
 *
 * All queries use parameterized $-placeholders — zero string concatenation in SQL.
 * Namespace isolation: every query is scoped by (agentId, userId).
 */

import type { DbPool } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SYSTEM_PROMPT_CHARS = 2000

/** Default TTL (in days) per category. NULL = no expiry. */
const DEFAULT_TTL: Readonly<Record<string, number | null>> = {
  preference: null,
  learned: 90,
  state: 1,
  general: null,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryRecord {
  readonly id: number
  readonly agentId: string
  readonly userId: string
  readonly key: string
  readonly value: unknown
  readonly category: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly accessedAt: string
  readonly accessCount: number
  readonly ttlDays: number | null
}

// ---------------------------------------------------------------------------
// Row conversion (pg → typed MemoryRecord)
// ---------------------------------------------------------------------------

function toMemoryRecord(row: Record<string, unknown>): MemoryRecord {
  return {
    id: Number(row['id']),
    agentId: String(row['agent_id'] ?? ''),
    userId: String(row['user_id'] ?? ''),
    key: String(row['key'] ?? ''),
    value: row['value'] ?? null,
    category: String(row['category'] ?? 'general'),
    createdAt: String(row['created_at'] ?? ''),
    updatedAt: String(row['updated_at'] ?? ''),
    accessedAt: String(row['accessed_at'] ?? ''),
    accessCount: Number(row['access_count'] ?? 0),
    ttlDays: row['ttl_days'] === null || row['ttl_days'] === undefined
      ? null
      : Number(row['ttl_days']),
  }
}

// ---------------------------------------------------------------------------
// Resolve TTL
// ---------------------------------------------------------------------------

function resolveTtl(category: string, explicitTtl: number | undefined): number | null {
  if (explicitTtl !== undefined) {
    if (!Number.isInteger(explicitTtl) || explicitTtl < 0) {
      throw new Error('ttlDays must be a non-negative integer')
    }
    return explicitTtl
  }
  if (category === 'cache') {
    throw new Error('cache category requires an explicit ttlDays value')
  }
  const defaultVal = DEFAULT_TTL[category]
  return defaultVal === undefined ? null : defaultVal
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Upsert a memory entry. INSERT ON CONFLICT UPDATE.
 * Default TTL depends on category (preference=∞, learned=90d, state=1d).
 * Cache category requires explicit ttlDays.
 */
async function set(
  pool: DbPool,
  agentId: string,
  userId: string,
  key: string,
  value: unknown,
  category: string = 'general',
  ttlDays?: number,
): Promise<MemoryRecord> {
  const resolvedTtl = resolveTtl(category, ttlDays)
  const { rows } = await pool.query(
    `INSERT INTO agent_memory (agent_id, user_id, key, value, category, ttl_days)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (agent_id, user_id, key)
     DO UPDATE SET value = $4, category = $5, ttl_days = $6, updated_at = NOW()
     RETURNING *`,
    [agentId, userId, key, JSON.stringify(value), category, resolvedTtl],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to upsert agent memory entry')
  return toMemoryRecord(row)
}

/**
 * Get a single memory value by key. Updates accessed_at and access_count.
 * Returns the value or null if not found.
 */
async function get(
  pool: DbPool,
  agentId: string,
  userId: string,
  key: string,
): Promise<unknown | null> {
  const { rows } = await pool.query(
    `UPDATE agent_memory
     SET accessed_at = NOW(), access_count = access_count + 1
     WHERE agent_id = $1 AND user_id = $2 AND key = $3
     RETURNING value`,
    [agentId, userId, key],
  )
  const row = rows[0]
  if (!row) return null
  return row['value'] ?? null
}

/**
 * Get all memory entries for an agent+user namespace.
 */
async function getAll(
  pool: DbPool,
  agentId: string,
  userId: string,
): Promise<readonly MemoryRecord[]> {
  const { rows } = await pool.query(
    `SELECT * FROM agent_memory
     WHERE agent_id = $1 AND user_id = $2
     ORDER BY updated_at DESC`,
    [agentId, userId],
  )
  return rows.map(toMemoryRecord)
}

/**
 * Get memory entries filtered by category.
 */
async function getByCategory(
  pool: DbPool,
  agentId: string,
  userId: string,
  category: string,
): Promise<readonly MemoryRecord[]> {
  const { rows } = await pool.query(
    `SELECT * FROM agent_memory
     WHERE agent_id = $1 AND user_id = $2 AND category = $3
     ORDER BY updated_at DESC`,
    [agentId, userId, category],
  )
  return rows.map(toMemoryRecord)
}

/**
 * Delete a single key from an agent+user namespace.
 */
async function deleteKey(
  pool: DbPool,
  agentId: string,
  userId: string,
  key: string,
): Promise<void> {
  await pool.query(
    'DELETE FROM agent_memory WHERE agent_id = $1 AND user_id = $2 AND key = $3',
    [agentId, userId, key],
  )
}

/**
 * Delete ALL entries for an agent+user namespace.
 */
async function deleteNamespace(
  pool: DbPool,
  agentId: string,
  userId: string,
): Promise<void> {
  await pool.query(
    'DELETE FROM agent_memory WHERE agent_id = $1 AND user_id = $2',
    [agentId, userId],
  )
}

/**
 * Delete entries where ttl_days is set and the entry has expired.
 * Returns number of deleted entries.
 */
async function cleanupExpired(pool: DbPool): Promise<number> {
  const { rows } = await pool.query(
    `DELETE FROM agent_memory
     WHERE ttl_days IS NOT NULL
       AND updated_at + (ttl_days || ' days')::INTERVAL < NOW()
     RETURNING id`,
    [],
  )
  return rows.length
}

/**
 * Delete cache entries that haven't been accessed in maxAgeDays.
 * Returns number of deleted entries.
 */
async function cleanupStaleCache(pool: DbPool, maxAgeDays: number): Promise<number> {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays <= 0) {
    throw new Error('maxAgeDays must be a positive integer')
  }
  const { rows } = await pool.query(
    `DELETE FROM agent_memory
     WHERE category = 'cache'
       AND accessed_at + ($1 || ' days')::INTERVAL < NOW()
     RETURNING id`,
    [maxAgeDays],
  )
  return rows.length
}

/**
 * Load preferences, learned, and state entries (not cache) and format
 * as readable text for system prompt injection.
 * Max 2000 chars — drops oldest entries if over limit.
 */
async function formatForSystemPrompt(
  pool: DbPool,
  agentId: string,
  userId: string,
): Promise<string> {
  const { rows } = await pool.query(
    `SELECT key, value, category FROM agent_memory
     WHERE agent_id = $1 AND user_id = $2 AND category != 'cache'
     ORDER BY category, updated_at DESC`,
    [agentId, userId],
  )

  const grouped: Record<string, string[]> = {}
  for (const row of rows) {
    const cat = String(row['category'] ?? 'general')
    const k = String(row['key'] ?? '')
    const v = row['value']
    const formatted = typeof v === 'string' ? v : JSON.stringify(v)
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(`- ${k}: ${formatted}`)
  }

  const categoryLabels: Readonly<Record<string, string>> = {
    preference: 'Vorlieben',
    learned: 'Gelerntes',
    state: 'Aktueller Zustand',
    general: 'Allgemein',
  }

  const sections: string[] = []
  for (const cat of ['preference', 'learned', 'state', 'general']) {
    const items = grouped[cat]
    if (!items || items.length === 0) continue
    const label = categoryLabels[cat] ?? cat
    sections.push(`## ${label}\n${items.join('\n')}`)
  }

  let result = sections.join('\n\n')

  if (result.length > MAX_SYSTEM_PROMPT_CHARS) {
    // Truncate by removing oldest entries (last items in each section)
    while (result.length > MAX_SYSTEM_PROMPT_CHARS && sections.length > 0) {
      // Remove the last line from the last section
      const lastSection = sections[sections.length - 1]!
      const lines = lastSection.split('\n')
      if (lines.length <= 1) {
        // Only header left — remove entire section
        sections.pop()
      } else {
        lines.pop()
        sections[sections.length - 1] = lines.join('\n')
      }
      result = sections.join('\n\n')
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  set,
  get,
  getAll,
  getByCategory,
  deleteKey,
  deleteNamespace,
  cleanupExpired,
  cleanupStaleCache,
  formatForSystemPrompt,
  resolveTtl,
}

export type { MemoryRecord }
