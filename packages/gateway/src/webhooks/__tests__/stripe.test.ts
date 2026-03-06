/**
 * Unit tests for Stripe Webhook handler.
 *
 * Mocks: stripe SDK, pg Pool, user-context cache
 * Run: cd packages/gateway && npx vitest run src/webhooks/__tests__/stripe.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { IncomingMessage, ServerResponse } from "node:http"

// ─── Mocks ───────────────────────────────────────────────────

const { mockConstructEvent, mockPoolQuery, mockInvalidate } = vi.hoisted(
  () => ({
    mockConstructEvent: vi.fn(),
    mockPoolQuery: vi.fn(),
    mockInvalidate: vi.fn(),
  }),
)

vi.mock("stripe", () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mockConstructEvent }
  },
}))

vi.mock("../../database/index.js", () => ({
  getPool: () => ({
    query: mockPoolQuery,
  }),
}))

vi.mock("../../database/user-context.js", () => ({
  userCache: {
    invalidate: mockInvalidate,
  },
}))

import { handleStripeWebhook } from "../stripe.js"

// ─── Helpers ─────────────────────────────────────────────────

function createMockReq(
  body: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const req = {
    headers: {
      "stripe-signature": "t=123,v1=sig",
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

describe("handleStripeWebhook", () => {
  const originalWebhookSecret = process.env["STRIPE_WEBHOOK_SECRET"]
  const originalSecretKey = process.env["STRIPE_SECRET_KEY"]

  beforeEach(() => {
    mockConstructEvent.mockReset()
    mockPoolQuery.mockReset()
    mockInvalidate.mockReset()

    process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_stripe_test"
    process.env["STRIPE_SECRET_KEY"] = "sk_test_abc"
    mockPoolQuery.mockResolvedValue({ rows: [] })
  })

  afterEach(() => {
    if (originalWebhookSecret !== undefined) {
      process.env["STRIPE_WEBHOOK_SECRET"] = originalWebhookSecret
    } else {
      delete process.env["STRIPE_WEBHOOK_SECRET"]
    }
    if (originalSecretKey !== undefined) {
      process.env["STRIPE_SECRET_KEY"] = originalSecretKey
    } else {
      delete process.env["STRIPE_SECRET_KEY"]
    }
  })

  it("returns 500 when STRIPE_WEBHOOK_SECRET is not set", async () => {
    delete process.env["STRIPE_WEBHOOK_SECRET"]
    const req = createMockReq("{}")
    const res = createMockRes()

    await handleStripeWebhook(req, res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toContain("STRIPE_WEBHOOK_SECRET")
  })

  it("returns 500 when STRIPE_SECRET_KEY is not set", async () => {
    delete process.env["STRIPE_SECRET_KEY"]
    const req = createMockReq("{}")
    const res = createMockRes()

    await handleStripeWebhook(req, res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toContain("STRIPE_SECRET_KEY")
  })

  it("returns 400 when Stripe signature is invalid", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature")
    })

    const req = createMockReq("{}")
    const res = createMockRes()

    await handleStripeWebhook(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body).toContain("Invalid webhook signature")
  })

  it("returns 400 when stripe-signature header is missing", async () => {
    const req = createMockReq("{}", { "stripe-signature": "" })
    ;(req.headers as Record<string, string>)["stripe-signature"] = ""
    const res = createMockRes()

    await handleStripeWebhook(req, res)

    expect(res.statusCode).toBe(400)
  })

  it("handles checkout.session.completed — upgrades to pro", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { clerk_id: "clerk_pro_user" },
          customer: "cus_123",
          subscription: "sub_456",
        },
      },
    })

    // Mock: SELECT returns the user
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("SELECT id FROM users")) {
        return Promise.resolve({ rows: [{ id: "uuid-pro" }] })
      }
      return Promise.resolve({ rows: [] })
    })

    const req = createMockReq("{}")
    const res = createMockRes()

    await handleStripeWebhook(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain("received")

    // Verify UPDATE to pro tier
    const updateCall = mockPoolQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        String(c[0]).includes("UPDATE users") &&
        String(c[0]).includes("tier = 'pro'"),
    )
    expect(updateCall).toBeDefined()
    expect(updateCall![1]).toContain("cus_123")
    expect(updateCall![1]).toContain("sub_456")

    // Verify budget limits upsert
    const budgetCall = mockPoolQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        String(c[0]).includes("INSERT INTO user_budget_limits"),
    )
    expect(budgetCall).toBeDefined()

    // Verify cache invalidation
    expect(mockInvalidate).toHaveBeenCalledWith("clerk_pro_user")
  })

  it("handles customer.subscription.deleted — downgrades to free", async () => {
    mockConstructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: {
        object: {
          customer: "cus_downgrade",
        },
      },
    })

    // Mock: SELECT returns user with clerk_id
    mockPoolQuery.mockImplementation((sql: string) => {
      if (
        typeof sql === "string" &&
        sql.includes("SELECT id, clerk_id FROM users")
      ) {
        return Promise.resolve({
          rows: [{ id: "uuid-downgrade", clerk_id: "clerk_downgrade" }],
        })
      }
      return Promise.resolve({ rows: [] })
    })

    const req = createMockReq("{}")
    const res = createMockRes()

    await handleStripeWebhook(req, res)

    expect(res.statusCode).toBe(200)

    // Verify UPDATE to free tier
    const updateCall = mockPoolQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        String(c[0]).includes("UPDATE users SET tier = 'free'"),
    )
    expect(updateCall).toBeDefined()

    // Verify budget limits reset
    const budgetCall = mockPoolQuery.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        String(c[0]).includes("UPDATE user_budget_limits"),
    )
    expect(budgetCall).toBeDefined()

    // Verify cache invalidation
    expect(mockInvalidate).toHaveBeenCalledWith("clerk_downgrade")
  })

  it("handles invoice.payment_failed — logs warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    mockConstructEvent.mockReturnValue({
      type: "invoice.payment_failed",
      data: {
        object: {
          customer: "cus_failed",
        },
      },
    })

    const req = createMockReq("{}")
    const res = createMockRes()

    await handleStripeWebhook(req, res)

    expect(res.statusCode).toBe(200)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Payment failed"),
    )

    warnSpy.mockRestore()
  })

  it("ignores unknown event types", async () => {
    mockConstructEvent.mockReturnValue({
      type: "unknown.event",
      data: { object: {} },
    })

    const req = createMockReq("{}")
    const res = createMockRes()

    await handleStripeWebhook(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain("received")
  })
})
