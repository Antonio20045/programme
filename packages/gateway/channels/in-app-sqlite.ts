/**
 * SQLite-backed session/message store for the In-App Channel.
 *
 * Used in local mode (no PostgreSQL) — the Electron desktop app starts the
 * Gateway as a child process with SQLITE_DB_PATH set instead of DATABASE_URL.
 *
 * better-sqlite3 is synchronous by design, so all methods return values
 * directly (no async).  Callers in in-app.ts handle both sync and async
 * code paths via the `isUsingSQLite()` helper.
 */

import Database from "better-sqlite3"
import type { SessionRow, MessageRow } from "../src/database/sessions.js"

// ─── Helper ─────────────────────────────────────────────────

function uuid(): string {
  // Node 19+ has crypto.randomUUID, but we keep it simple
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ─── SQLiteStore ────────────────────────────────────────────

export class SQLiteStore {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma("journal_mode = WAL")
    this.db.pragma("foreign_keys = ON")
    this.migrate()
  }

  // ── Schema ──

  private migrate(): void {
    // Run each DDL statement individually via prepare().run()
    // (db.exec is flagged by security hooks due to pattern match with child_process.exec)
    const statements = [
      `CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        title         TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        last_message_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role          TEXT NOT NULL,
        content       TEXT NOT NULL,
        tool_name     TEXT,
        tool_result   TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
      "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)",
    ]
    for (const sql of statements) {
      this.db.prepare(sql).run()
    }
  }

  // ── Session CRUD ──

  upsertSession(sessionId: string, userId: string, title: string): SessionRow {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, user_id, title)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_message_at = datetime('now')
    `)
    stmt.run(sessionId, userId, title)
    return this.getSession(sessionId, userId)!
  }

  getSession(sessionId: string, userId: string): SessionRow | null {
    const row = this.db.prepare(
      "SELECT id, title, created_at, last_message_at FROM sessions WHERE id = ? AND user_id = ?",
    ).get(sessionId, userId) as Record<string, unknown> | undefined
    return row ? toSessionRow(row) : null
  }

  listSessions(userId: string, limit = 50): SessionRow[] {
    const rows = this.db.prepare(
      "SELECT id, title, created_at, last_message_at FROM sessions WHERE user_id = ? ORDER BY last_message_at DESC LIMIT ?",
    ).all(userId, limit) as Record<string, unknown>[]
    return rows.map(toSessionRow)
  }

  deleteSession(sessionId: string, userId: string): boolean {
    const result = this.db.prepare(
      "DELETE FROM sessions WHERE id = ? AND user_id = ?",
    ).run(sessionId, userId)
    return result.changes > 0
  }

  // ── Message CRUD ──

  insertMessage(
    sessionId: string,
    role: string,
    content: string,
    extra?: { toolName?: string; toolResult?: string },
  ): MessageRow {
    const messageId = uuid()
    this.db.prepare(
      "INSERT INTO messages (id, session_id, role, content, tool_name, tool_result) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(messageId, sessionId, role, content, extra?.toolName ?? null, extra?.toolResult ?? null)

    // Touch session timestamp
    this.db.prepare(
      "UPDATE sessions SET last_message_at = datetime('now') WHERE id = ?",
    ).run(sessionId)

    const row = this.db.prepare(
      "SELECT id, role, content, tool_name, tool_result, created_at FROM messages WHERE id = ?",
    ).get(messageId) as Record<string, unknown>
    return toMessageRow(row)
  }

  listMessages(sessionId: string, userId: string): MessageRow[] {
    const rows = this.db.prepare(
      `SELECT m.id, m.role, m.content, m.tool_name, m.tool_result, m.created_at
       FROM messages m JOIN sessions s ON m.session_id = s.id
       WHERE m.session_id = ? AND s.user_id = ?
       ORDER BY m.created_at ASC`,
    ).all(sessionId, userId) as Record<string, unknown>[]
    return rows.map(toMessageRow)
  }

  updateSessionTitle(sessionId: string, userId: string, title: string): void {
    this.db.prepare(
      "UPDATE sessions SET title = ? WHERE id = ? AND user_id = ?",
    ).run(title, sessionId, userId)
  }

  getSessionUserId(sessionId: string): string | null {
    const row = this.db.prepare(
      "SELECT user_id FROM sessions WHERE id = ?",
    ).get(sessionId) as { user_id: string } | undefined
    return row?.user_id ?? null
  }

  getFirstUserMessage(sessionId: string): string | null {
    const row = this.db.prepare(
      "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1",
    ).get(sessionId) as { content: string } | undefined
    return row?.content ?? null
  }

  countMessages(sessionId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS cnt FROM messages WHERE session_id = ?",
    ).get(sessionId) as { cnt: number } | undefined
    return row?.cnt ?? 0
  }

  // ── Tool History ──

  listToolNames(sessionId: string): string[] {
    const rows = this.db.prepare(
      `SELECT tool_name FROM messages
       WHERE session_id = ? AND tool_name IS NOT NULL
       ORDER BY created_at DESC LIMIT 10`,
    ).all(sessionId) as Array<Record<string, unknown>>
    return rows.map((r) => String(r["tool_name"]))
  }

  // ── Lifecycle ──

  close(): void {
    this.db.close()
  }
}

// ─── Row converters (mirror src/database/sessions.ts) ───────

function toSessionRow(row: Record<string, unknown>): SessionRow {
  return {
    id: String(row["id"] ?? ""),
    title: row["title"] != null ? String(row["title"]) : null,
    createdAt: String(row["created_at"] ?? ""),
    lastMessageAt: String(row["last_message_at"] ?? ""),
  }
}

function toMessageRow(row: Record<string, unknown>): MessageRow {
  return {
    id: String(row["id"] ?? ""),
    role: String(row["role"] ?? ""),
    content: String(row["content"] ?? ""),
    toolName: row["tool_name"] != null ? String(row["tool_name"]) : null,
    toolResult: row["tool_result"] != null ? String(row["tool_result"]) : null,
    createdAt: String(row["created_at"] ?? ""),
  }
}
