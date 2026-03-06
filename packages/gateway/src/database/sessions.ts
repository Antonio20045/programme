/**
 * Session & Message CRUD — PostgreSQL, user-scoped.
 * All queries use $N-placeholders — zero string concatenation in SQL.
 *
 * Session/message tables already exist in 001_initial.sql.
 * Messages cascade-delete with their session.
 */

// Minimal pool interface (no cross-package dependency)
interface DbPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionRow {
  readonly id: string        // UUID
  readonly title: string | null
  readonly createdAt: string // TIMESTAMPTZ
  readonly lastMessageAt: string
}

export interface MessageRow {
  readonly id: string
  readonly role: string
  readonly content: string
  readonly toolName: string | null
  readonly toolResult: string | null
  readonly createdAt: string
}

// ---------------------------------------------------------------------------
// Row converters
// ---------------------------------------------------------------------------

function toSessionRow(row: Record<string, unknown>): SessionRow {
  return {
    id: String(row['id'] ?? ''),
    title: row['title'] != null ? String(row['title']) : null,
    createdAt: String(row['created_at'] ?? ''),
    lastMessageAt: String(row['last_message_at'] ?? ''),
  }
}

function toMessageRow(row: Record<string, unknown>): MessageRow {
  return {
    id: String(row['id'] ?? ''),
    role: String(row['role'] ?? ''),
    content: String(row['content'] ?? ''),
    toolName: row['tool_name'] != null ? String(row['tool_name']) : null,
    toolResult: row['tool_result'] != null ? String(row['tool_result']) : null,
    createdAt: String(row['created_at'] ?? ''),
  }
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

/**
 * Create a session or update its last_message_at timestamp (idempotent).
 */
export async function upsertSession(
  pool: DbPool,
  sessionId: string,
  userId: string,
  title: string,
): Promise<SessionRow> {
  const { rows } = await pool.query(
    `INSERT INTO sessions (id, user_id, title)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET last_message_at = NOW()
     RETURNING id, title, created_at, last_message_at`,
    [sessionId, userId, title],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to upsert session')
  return toSessionRow(row)
}

/**
 * Get a single session (user-scoped).
 */
export async function getSession(
  pool: DbPool,
  sessionId: string,
  userId: string,
): Promise<SessionRow | null> {
  const { rows } = await pool.query(
    `SELECT id, title, created_at, last_message_at
     FROM sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  )
  const row = rows[0]
  return row ? toSessionRow(row) : null
}

/**
 * List sessions for a user, sorted by most recent activity.
 */
export async function listSessions(
  pool: DbPool,
  userId: string,
  limit?: number,
): Promise<SessionRow[]> {
  const effectiveLimit = limit ?? 50
  const { rows } = await pool.query(
    `SELECT id, title, created_at, last_message_at
     FROM sessions WHERE user_id = $1
     ORDER BY last_message_at DESC LIMIT $2`,
    [userId, effectiveLimit],
  )
  return rows.map(toSessionRow)
}

/**
 * Delete a session (user-scoped). Messages cascade-delete via FK.
 */
export async function deleteSession(
  pool: DbPool,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    'DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id',
    [sessionId, userId],
  )
  return rows.length > 0
}

/**
 * Update a session's title.
 */
export async function updateSessionTitle(
  pool: DbPool,
  sessionId: string,
  userId: string,
  title: string,
): Promise<void> {
  await pool.query(
    'UPDATE sessions SET title = $1 WHERE id = $2 AND user_id = $3',
    [title, sessionId, userId],
  )
}

/**
 * Count messages in a session.
 */
export async function countMessages(
  pool: DbPool,
  sessionId: string,
): Promise<number> {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS cnt FROM messages WHERE session_id = $1',
    [sessionId],
  )
  const row = rows[0]
  return row ? Number(row['cnt']) : 0
}

// ---------------------------------------------------------------------------
// Message CRUD
// ---------------------------------------------------------------------------

/**
 * Insert a message and touch the session's last_message_at.
 */
export async function insertMessage(
  pool: DbPool,
  sessionId: string,
  role: string,
  content: string,
  extra?: { toolName?: string; toolResult?: string },
): Promise<MessageRow> {
  const { rows } = await pool.query(
    `INSERT INTO messages (session_id, role, content, tool_name, tool_result)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, role, content, tool_name, tool_result, created_at`,
    [sessionId, role, content, extra?.toolName ?? null, extra?.toolResult ?? null],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to insert message')

  // Touch session timestamp (fire-and-forget for perf, errors logged not thrown)
  await pool.query(
    'UPDATE sessions SET last_message_at = NOW() WHERE id = $1',
    [sessionId],
  )

  return toMessageRow(row)
}

/**
 * List messages for a session (user-scoped via JOIN).
 */
export async function listMessages(
  pool: DbPool,
  sessionId: string,
  userId: string,
): Promise<MessageRow[]> {
  const { rows } = await pool.query(
    `SELECT m.id, m.role, m.content, m.tool_name, m.tool_result, m.created_at
     FROM messages m JOIN sessions s ON m.session_id = s.id
     WHERE m.session_id = $1 AND s.user_id = $2
     ORDER BY m.created_at ASC`,
    [sessionId, userId],
  )
  return rows.map(toMessageRow)
}
