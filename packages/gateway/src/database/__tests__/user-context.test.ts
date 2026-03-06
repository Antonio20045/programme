/**
 * Unit tests for User-Context Resolver.
 *
 * Mocks: pg Pool, @clerk/backend
 * Run: cd packages/gateway && npx vitest run src/database/__tests__/user-context.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Pool, PoolClient, QueryResult } from "pg"
import type { IncomingMessage } from "node:http"

// ─── Mocks ───────────────────────────────────────────────────

const { mockVerifyToken, mockPoolQuery, mockPoolConnect } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
}))

// Mock @clerk/backend
vi.mock("@clerk/backend", () => ({
  verifyToken: mockVerifyToken,
}))

// Mock ../index.js (getPool)
vi.mock("../index.js", () => ({
  getPool: () =>
    ({
      query: mockPoolQuery,
      connect: mockPoolConnect,
    }) as unknown as Pool,
}))

import {
  UserCache,
  userCache,
  resolveUserContext,
  authenticateRequest,
  type RequestContext,
} from "../user-context.js"

// ─── Helpers ─────────────────────────────────────────────────

function createMockPool(
  existingUser?: { id: string; clerk_id: string; email: string; tier: string },
): { pool: Pool; client: PoolClient } {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] } as QueryResult),
    release: vi.fn(),
  } as unknown as PoolClient

  const pool = {
    query: vi.fn().mockImplementation((sql: string) => {
      if (
        typeof sql === "string" &&
        sql.includes("SELECT id, clerk_id, email, tier FROM users")
      ) {
        return Promise.resolve({
          rows: existingUser ? [existingUser] : [],
        } as QueryResult)
      }
      return Promise.resolve({ rows: [] } as QueryResult)
    }),
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool

  // Make client.query return id for INSERT...RETURNING
  vi.mocked(client.query).mockImplementation((sql: string) => {
    if (typeof sql === "string" && sql.includes("RETURNING id")) {
      return Promise.resolve({
        rows: [{ id: "new-uuid-123" }],
      } as QueryResult)
    }
    return Promise.resolve({ rows: [] } as QueryResult)
  })

  return { pool, client }
}

function createMockReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

// ─── Tests ───────────────────────────────────────────────────

describe("UserCache", () => {
  let cache: UserCache

  beforeEach(() => {
    cache = new UserCache()
  })

  it("returns null for unknown keys", () => {
    expect(cache.get("nonexistent")).toBeNull()
  })

  it("stores and retrieves context", () => {
    const ctx: RequestContext = {
      userId: "uuid-1",
      clerkId: "clerk_1",
      tier: "free",
      email: "test@example.com",
    }
    cache.set("clerk_1", ctx)
    expect(cache.get("clerk_1")).toEqual(ctx)
  })

  it("invalidates a cached entry", () => {
    const ctx: RequestContext = {
      userId: "uuid-1",
      clerkId: "clerk_1",
      tier: "free",
      email: "test@example.com",
    }
    cache.set("clerk_1", ctx)
    cache.invalidate("clerk_1")
    expect(cache.get("clerk_1")).toBeNull()
  })

  it("expires entries after TTL", () => {
    const ctx: RequestContext = {
      userId: "uuid-1",
      clerkId: "clerk_1",
      tier: "free",
      email: "test@example.com",
    }
    cache.set("clerk_1", ctx)

    // Advance time past TTL (5 minutes)
    vi.useFakeTimers()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    expect(cache.get("clerk_1")).toBeNull()
    vi.useRealTimers()
  })

  it("evicts oldest entry when at capacity", () => {
    // Fill cache to max (1000)
    for (let i = 0; i < 1000; i++) {
      cache.set(`clerk_${String(i)}`, {
        userId: `uuid-${String(i)}`,
        clerkId: `clerk_${String(i)}`,
        tier: "free",
        email: `test${String(i)}@example.com`,
      })
    }
    expect(cache.size).toBe(1000)

    // Add one more — oldest (clerk_0) should be evicted
    cache.set("clerk_new", {
      userId: "uuid-new",
      clerkId: "clerk_new",
      tier: "free",
      email: "new@example.com",
    })
    expect(cache.size).toBe(1000)
    expect(cache.get("clerk_0")).toBeNull()
    expect(cache.get("clerk_new")).not.toBeNull()
  })

  it("clear removes all entries", () => {
    cache.set("clerk_1", {
      userId: "uuid-1",
      clerkId: "clerk_1",
      tier: "free",
      email: "test@example.com",
    })
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get("clerk_1")).toBeNull()
  })
})

describe("resolveUserContext", () => {
  beforeEach(() => {
    userCache.clear()
    vi.clearAllMocks()
  })

  it("returns existing user from DB and caches it", async () => {
    const { pool } = createMockPool({
      id: "uuid-existing",
      clerk_id: "clerk_existing",
      email: "existing@example.com",
      tier: "pro",
    })

    const ctx = await resolveUserContext(
      pool,
      "clerk_existing",
      "existing@example.com",
    )

    expect(ctx).toEqual({
      userId: "uuid-existing",
      clerkId: "clerk_existing",
      tier: "pro",
      email: "existing@example.com",
    })

    // Second call should use cache — no additional DB query
    const ctx2 = await resolveUserContext(
      pool,
      "clerk_existing",
      "existing@example.com",
    )
    expect(ctx2).toEqual(ctx)
    // Only 1 SELECT query (the first call)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it("auto-creates a new user with settings", async () => {
    const { pool, client } = createMockPool(undefined) // No existing user

    const ctx = await resolveUserContext(
      pool,
      "clerk_new",
      "new@example.com",
      "New User",
    )

    expect(ctx).toEqual({
      userId: "new-uuid-123",
      clerkId: "clerk_new",
      tier: "free",
      email: "new@example.com",
    })

    // Should have called BEGIN, INSERT users, INSERT user_settings, COMMIT
    const clientCalls = vi.mocked(client.query).mock.calls.map((c) => c[0])
    expect(clientCalls).toContain("BEGIN")
    expect(clientCalls).toContain("COMMIT")
    expect(clientCalls.some((s) => String(s).includes("INSERT INTO users"))).toBe(true)
    expect(
      clientCalls.some((s) => String(s).includes("INSERT INTO user_settings")),
    ).toBe(true)
    expect(client.release).toHaveBeenCalled()
  })

  it("rolls back and throws on DB error during auto-create", async () => {
    const { pool, client } = createMockPool(undefined)

    const dbError = new Error("DB insert failed")
    vi.mocked(client.query).mockImplementation((sql: string) => {
      if (sql === "BEGIN") return Promise.resolve({ rows: [] } as QueryResult)
      if (typeof sql === "string" && sql.includes("INSERT INTO users")) {
        return Promise.reject(dbError)
      }
      return Promise.resolve({ rows: [] } as QueryResult)
    })

    await expect(
      resolveUserContext(pool, "clerk_fail", "fail@example.com"),
    ).rejects.toThrow("DB insert failed")

    const clientCalls = vi.mocked(client.query).mock.calls.map((c) => c[0])
    expect(clientCalls).toContain("ROLLBACK")
    expect(clientCalls).not.toContain("COMMIT")
    expect(client.release).toHaveBeenCalled()
  })

  it("uses cache on second call, skipping DB", async () => {
    const { pool } = createMockPool({
      id: "uuid-cached",
      clerk_id: "clerk_cached",
      email: "cached@example.com",
      tier: "free",
    })

    // First call fetches from DB
    await resolveUserContext(pool, "clerk_cached", "cached@example.com")
    expect(pool.query).toHaveBeenCalledTimes(1)

    // Second call uses cache
    await resolveUserContext(pool, "clerk_cached", "cached@example.com")
    expect(pool.query).toHaveBeenCalledTimes(1) // Still 1
  })
})

describe("authenticateRequest", () => {
  const originalClerkKey = process.env["CLERK_SECRET_KEY"]

  beforeEach(() => {
    userCache.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalClerkKey !== undefined) {
      process.env["CLERK_SECRET_KEY"] = originalClerkKey
    } else {
      delete process.env["CLERK_SECRET_KEY"]
    }
  })

  it("returns null when CLERK_SECRET_KEY is not set", async () => {
    delete process.env["CLERK_SECRET_KEY"]
    const req = createMockReq({ "x-clerk-token": "some-jwt" })
    const result = await authenticateRequest(req)
    expect(result).toBeNull()
  })

  it("returns null when x-clerk-token header is missing", async () => {
    process.env["CLERK_SECRET_KEY"] = "sk_test_abc"
    const req = createMockReq({})
    const result = await authenticateRequest(req)
    expect(result).toBeNull()
  })

  it("returns null when JWT verification fails", async () => {
    process.env["CLERK_SECRET_KEY"] = "sk_test_abc"
    mockVerifyToken.mockResolvedValue({
      errors: [new Error("Invalid token")],
    })
    const req = createMockReq({ "x-clerk-token": "bad-jwt" })
    const result = await authenticateRequest(req)
    expect(result).toBeNull()
  })

  it("returns RequestContext for valid JWT with existing user", async () => {
    process.env["CLERK_SECRET_KEY"] = "sk_test_abc"
    mockVerifyToken.mockResolvedValue({
      data: {
        sub: "clerk_valid",
        email: "valid@example.com",
        name: "Valid User",
      },
    })

    // Mock getPool to return existing user
    mockPoolQuery.mockImplementation((sql: string) => {
      if (
        typeof sql === "string" &&
        sql.includes("SELECT id, clerk_id, email, tier FROM users")
      ) {
        return Promise.resolve({
          rows: [
            {
              id: "uuid-valid",
              clerk_id: "clerk_valid",
              email: "valid@example.com",
              tier: "pro",
            },
          ],
        })
      }
      return Promise.resolve({ rows: [] })
    })

    const req = createMockReq({ "x-clerk-token": "valid-jwt" })
    const result = await authenticateRequest(req)

    expect(result).toEqual({
      userId: "uuid-valid",
      clerkId: "clerk_valid",
      tier: "pro",
      email: "valid@example.com",
    })
    expect(mockVerifyToken).toHaveBeenCalledWith("valid-jwt", {
      secretKey: "sk_test_abc",
    })
  })
})
