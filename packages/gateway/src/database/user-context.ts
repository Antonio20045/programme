/**
 * User-Context Resolver for Multi-User Auth.
 *
 * Extracts user_id from Clerk JWT and resolves the PostgreSQL user.
 * Every API request MUST go through authenticateRequest() (except webhooks/health).
 * Without a valid JWT → caller returns 401.
 */
import type { IncomingMessage } from "node:http"
import { verifyToken } from "@clerk/backend"
import type { Pool } from "pg"
import { getPool } from "./index.js"

// ─── Types ───────────────────────────────────────────────────

export interface RequestContext {
  readonly userId: string       // PostgreSQL UUID
  readonly clerkId: string      // Clerk User ID
  readonly tier: "free" | "pro"
  readonly email: string
}

// ─── LRU Cache ───────────────────────────────────────────────

interface CacheEntry {
  readonly context: RequestContext
  readonly timestamp: number
}

const MAX_CACHE_ENTRIES = 1000
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export class UserCache {
  private readonly entries = new Map<string, CacheEntry>()

  get(clerkId: string): RequestContext | null {
    const entry = this.entries.get(clerkId)
    if (!entry) return null

    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this.entries.delete(clerkId)
      return null
    }

    // Move to end for LRU ordering
    this.entries.delete(clerkId)
    this.entries.set(clerkId, entry)
    return entry.context
  }

  set(clerkId: string, context: RequestContext): void {
    // Evict oldest if at capacity
    if (this.entries.size >= MAX_CACHE_ENTRIES && !this.entries.has(clerkId)) {
      const oldest = this.entries.keys().next()
      if (!oldest.done) {
        this.entries.delete(oldest.value)
      }
    }

    this.entries.set(clerkId, { context, timestamp: Date.now() })
  }

  invalidate(clerkId: string): void {
    this.entries.delete(clerkId)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}

export const userCache = new UserCache()

// ─── resolveUserContext ──────────────────────────────────────

/**
 * Looks up or auto-creates a user in PostgreSQL from a Clerk user ID.
 * Uses the LRU cache to avoid repeated DB queries.
 */
export async function resolveUserContext(
  pool: Pool,
  clerkUserId: string,
  email: string,
  name?: string,
): Promise<RequestContext> {
  // 1. Check cache
  const cached = userCache.get(clerkUserId)
  if (cached) return cached

  // 2. Try to find existing user
  const { rows } = await pool.query<{
    id: string
    clerk_id: string
    email: string
    tier: string
  }>("SELECT id, clerk_id, email, tier FROM users WHERE clerk_id = $1", [
    clerkUserId,
  ])

  if (rows[0]) {
    const ctx: RequestContext = {
      userId: rows[0].id,
      clerkId: rows[0].clerk_id,
      tier: rows[0].tier as "free" | "pro",
      email: rows[0].email,
    }
    userCache.set(clerkUserId, ctx)
    return ctx
  }

  // 3. Auto-create (Lazy Registration)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const insertResult = await client.query<{ id: string }>(
      "INSERT INTO users (clerk_id, email, name, tier) VALUES ($1, $2, $3, $4) RETURNING id",
      [clerkUserId, email, name ?? null, "free"],
    )
    const userId = insertResult.rows[0]!.id

    await client.query("INSERT INTO user_settings (user_id) VALUES ($1)", [
      userId,
    ])

    await client.query("COMMIT")

    const ctx: RequestContext = {
      userId,
      clerkId: clerkUserId,
      tier: "free",
      email,
    }
    userCache.set(clerkUserId, ctx)
    return ctx
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

// ─── authenticateRequest ─────────────────────────────────────

/**
 * Raw-HTTP auth guard. Extracts Clerk JWT from x-clerk-token header,
 * verifies it, and resolves the PostgreSQL user.
 *
 * Returns null when:
 * - CLERK_SECRET_KEY is not set (dev mode, no auth)
 * - Token is missing or invalid
 *
 * Caller decides whether null → 401 or passthrough.
 */
export async function authenticateRequest(
  req: IncomingMessage,
): Promise<RequestContext | null> {
  const clerkSecretKey = process.env["CLERK_SECRET_KEY"]
  if (!clerkSecretKey) return null

  const clerkHeader = req.headers["x-clerk-token"]
  const clerkToken = Array.isArray(clerkHeader) ? clerkHeader[0] : clerkHeader
  if (!clerkToken) return null

  try {
    const result = await verifyToken(clerkToken, { secretKey: clerkSecretKey })

    if (result.errors) return null

    const payload = result.data as { sub: string; email?: string; name?: string }
    const clerkUserId = payload.sub
    const email = payload.email
    const name = payload.name

    if (!clerkUserId) return null

    const pool = getPool()
    return await resolveUserContext(
      pool,
      clerkUserId,
      email ?? `${clerkUserId}@clerk.user`,
      name,
    )
  } catch {
    return null
  }
}
