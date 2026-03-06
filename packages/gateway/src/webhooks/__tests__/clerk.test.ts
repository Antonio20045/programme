/**
 * Unit tests for Clerk Webhook handler.
 *
 * Mocks: svix Webhook, pg Pool, user-context cache
 * Run: cd packages/gateway && npx vitest run src/webhooks/__tests__/clerk.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { IncomingMessage, ServerResponse } from "node:http"

// ─── Mocks ───────────────────────────────────────────────────

// vi.hoisted ensures these are available when vi.mock factories run
const {
  mockVerify,
  mockPoolQuery,
  mockClientQuery,
  mockClientRelease,
  mockInvalidate,
  mockConnect,
} = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockClientQuery: vi.fn(),
  mockClientRelease: vi.fn(),
  mockInvalidate: vi.fn(),
  mockConnect: vi.fn(),
}))

vi.mock("svix", () => ({
  Webhook: class MockWebhook {
    verify = mockVerify
  },
}))

vi.mock("../../database/index.js", () => ({
  getPool: () => ({
    query: mockPoolQuery,
    connect: mockConnect,
  }),
}))

vi.mock("../../database/user-context.js", () => ({
  userCache: {
    invalidate: mockInvalidate,
  },
}))

import { handleClerkWebhook } from "../clerk.js"

// ─── Helpers ─────────────────────────────────────────────────

function createMockReq(
  body: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const req = {
    headers: {
      "svix-id": "msg_test",
      "svix-timestamp": "1234567890",
      "svix-signature": "v1,sig",
      ...headers,
    },
    on: vi.fn().mockImplementation(function (
      this: IncomingMessage,
      event: string,
      cb: (...args: unknown[]) => void,
    ) {
      if (event === "data") {
        cb(Buffer.from(body))
      }
      if (event === "end") {
        cb()
      }
      return this
    }),
    destroy: vi.fn(),
  } as unknown as IncomingMessage
  return req
}

function createMockRes(): ServerResponse & {
  statusCode: number
  body: string
} {
  const res = {
    statusCode: 200,
    body: "",
    writeHead(status: number) {
      this.statusCode = status
      return this
    },
    end(data?: string) {
      if (data) this.body = data
      return this
    },
  } as unknown as ServerResponse & { statusCode: number; body: string }
  return res
}

// ─── Tests ───────────────────────────────────────────────────

describe("handleClerkWebhook", () => {
  const originalEnv = process.env["CLERK_WEBHOOK_SECRET"]

  beforeEach(() => {
    mockVerify.mockReset()
    mockPoolQuery.mockReset()
    mockClientQuery.mockReset()
    mockClientRelease.mockReset()
    mockInvalidate.mockReset()
    mockConnect.mockReset()

    process.env["CLERK_WEBHOOK_SECRET"] = "whsec_test_secret"

    // Default: client mock for transactions
    mockClientQuery.mockResolvedValue({ rows: [] })
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    })
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["CLERK_WEBHOOK_SECRET"] = originalEnv
    } else {
      delete process.env["CLERK_WEBHOOK_SECRET"]
    }
  })

  it("returns 500 when CLERK_WEBHOOK_SECRET is not set", async () => {
    delete process.env["CLERK_WEBHOOK_SECRET"]
    const req = createMockReq("{}")
    const res = createMockRes()

    await handleClerkWebhook(req, res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toContain("CLERK_WEBHOOK_SECRET")
  })

  it("returns 400 when Svix signature is invalid", async () => {
    mockVerify.mockImplementation(() => {
      throw new Error("Invalid signature")
    })

    const req = createMockReq("{}")
    const res = createMockRes()

    await handleClerkWebhook(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body).toContain("Invalid webhook signature")
  })

  it("returns 400 when Svix headers are missing", async () => {
    const req = createMockReq("{}", {
      "svix-id": "",
      "svix-timestamp": "",
      "svix-signature": "",
    })
    ;(req.headers as Record<string, string>)["svix-id"] = ""
    const res = createMockRes()

    await handleClerkWebhook(req, res)

    expect(res.statusCode).toBe(400)
  })

  it("handles user.created — inserts user + settings", async () => {
    const event = {
      type: "user.created",
      data: {
        id: "user_clerk_new",
        email_addresses: [
          { id: "email_1", email_address: "new@example.com" },
        ],
        primary_email_address_id: "email_1",
        first_name: "New",
        last_name: "User",
      },
    }
    mockVerify.mockReturnValue(event)

    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("SELECT id FROM users")) {
        return Promise.resolve({ rows: [{ id: "uuid-new" }] })
      }
      return Promise.resolve({ rows: [] })
    })

    const req = createMockReq(JSON.stringify(event))
    const res = createMockRes()

    await handleClerkWebhook(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain("ok")

    const insertCalls = mockClientQuery.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("INSERT"),
    )
    expect(insertCalls.length).toBeGreaterThanOrEqual(2)
    expect(mockInvalidate).toHaveBeenCalledWith("user_clerk_new")
  })

  it("handles user.updated — updates email and name", async () => {
    const event = {
      type: "user.updated",
      data: {
        id: "user_clerk_upd",
        email_addresses: [
          { id: "email_1", email_address: "updated@example.com" },
        ],
        primary_email_address_id: "email_1",
        first_name: "Updated",
        last_name: "Name",
      },
    }
    mockVerify.mockReturnValue(event)
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const req = createMockReq(JSON.stringify(event))
    const res = createMockRes()

    await handleClerkWebhook(req, res)

    expect(res.statusCode).toBe(200)

    const updateCall = mockPoolQuery.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("UPDATE users"),
    )
    expect(updateCall).toBeDefined()
    expect(updateCall![1]).toContain("updated@example.com")
    expect(mockInvalidate).toHaveBeenCalledWith("user_clerk_upd")
  })

  it("handles user.deleted — deletes user (CASCADE)", async () => {
    const event = {
      type: "user.deleted",
      data: { id: "user_clerk_del" },
    }
    mockVerify.mockReturnValue(event)
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const req = createMockReq(JSON.stringify(event))
    const res = createMockRes()

    await handleClerkWebhook(req, res)

    expect(res.statusCode).toBe(200)

    const deleteCall = mockPoolQuery.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("DELETE FROM users"),
    )
    expect(deleteCall).toBeDefined()
    expect(deleteCall![1]).toEqual(["user_clerk_del"])
    expect(mockInvalidate).toHaveBeenCalledWith("user_clerk_del")
  })

  it("invalidates cache after every event", async () => {
    const event = {
      type: "user.updated",
      data: {
        id: "user_cache_test",
        email_addresses: [
          { id: "email_1", email_address: "cache@example.com" },
        ],
        primary_email_address_id: "email_1",
      },
    }
    mockVerify.mockReturnValue(event)
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const req = createMockReq(JSON.stringify(event))
    const res = createMockRes()

    await handleClerkWebhook(req, res)

    expect(mockInvalidate).toHaveBeenCalledWith("user_cache_test")
  })
})
