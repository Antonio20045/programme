import { describe, it, expect, vi, beforeEach } from "vitest"
import { MockStorage, MockState } from "./helpers"

// Mock cloudflare:workers before importing
vi.mock("cloudflare:workers", () => {
  return {
    DurableObject: class {
      ctx: { storage: MockStorage }
      env: Record<string, unknown>
      constructor(ctx: unknown, env: unknown) {
        this.ctx = ctx as { storage: MockStorage }
        this.env = env as Record<string, unknown>
      }
    },
  }
})

import { OfflineQueue } from "../src/offline-queue"

const TEST_ENV = { JWT_SECRET: "test-secret", DEVICE_REGISTRY: {}, OFFLINE_QUEUE: {} }

function createQueue(): OfflineQueue {
  const state = new MockState()
  return new OfflineQueue(state as never, TEST_ENV as never)
}

function makeRequest(path: string, method: string, body?: unknown): Request {
  const options: RequestInit = { method, headers: { "Content-Type": "application/json" } }
  if (body) options.body = JSON.stringify(body)
  return new Request(`https://do${path}`, options)
}

describe("OfflineQueue", () => {
  let queue: OfflineQueue

  beforeEach(() => {
    queue = createQueue()
  })

  it("enqueue returns 201", async () => {
    const resp = await queue.fetch(
      makeRequest("/enqueue", "POST", { from: "device-a", payload: "encrypted-data" })
    )

    expect(resp.status).toBe(201)
    const data = (await resp.json()) as { ok: boolean }
    expect(data.ok).toBe(true)
  })

  it("drain returns messages in FIFO order", async () => {
    // Mock Date.now to return distinct timestamps for stable FIFO ordering
    let fakeTime = 1700000000000
    const originalDateNow = Date.now
    vi.spyOn(Date, "now").mockImplementation(() => fakeTime++)

    for (let i = 0; i < 3; i++) {
      await queue.fetch(
        makeRequest("/enqueue", "POST", { from: "device-a", payload: `message-${i}` })
      )
    }

    Date.now = originalDateNow

    const resp = await queue.fetch(makeRequest("/drain", "GET"))
    expect(resp.status).toBe(200)

    const data = (await resp.json()) as {
      messages: Array<{ from: string; payload: string }>
      count: number
    }
    expect(data.count).toBe(3)
    expect(data.messages[0]!.payload).toBe("message-0")
    expect(data.messages[1]!.payload).toBe("message-1")
    expect(data.messages[2]!.payload).toBe("message-2")
  })

  it("drain on empty queue returns count 0", async () => {
    const resp = await queue.fetch(makeRequest("/drain", "GET"))
    expect(resp.status).toBe(200)

    const data = (await resp.json()) as { count: number }
    expect(data.count).toBe(0)
  })

  it("drain empties the queue", async () => {
    await queue.fetch(
      makeRequest("/enqueue", "POST", { from: "device-a", payload: "data" })
    )

    // First drain
    await queue.fetch(makeRequest("/drain", "GET"))

    // Second drain should be empty
    const resp = await queue.fetch(makeRequest("/drain", "GET"))
    const data = (await resp.json()) as { count: number }
    expect(data.count).toBe(0)
  })

  it("rejects 1001st message with 429 QUEUE_FULL", async () => {
    // Fill queue to max
    for (let i = 0; i < 1000; i++) {
      await queue.fetch(
        makeRequest("/enqueue", "POST", { from: "device-a", payload: `msg-${i}` })
      )
    }

    // 1001st should fail
    const resp = await queue.fetch(
      makeRequest("/enqueue", "POST", { from: "device-a", payload: "overflow" })
    )

    expect(resp.status).toBe(429)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("QUEUE_FULL")
  })

  it("cleanup removes old messages and keeps new ones", async () => {
    // Enqueue a message
    await queue.fetch(
      makeRequest("/enqueue", "POST", { from: "device-a", payload: "old-message" })
    )

    // Manipulate the storedAt to make it old
    const state = (queue as unknown as { ctx: MockState }).ctx
    const entries = await state.storage.list<{ storedAt: number }>({ prefix: "msg:" })
    for (const [key, msg] of entries) {
      msg.storedAt = Date.now() - 25 * 60 * 60 * 1000 // 25 hours ago
      await state.storage.put(key, msg)
    }

    // Add a fresh message
    await queue.fetch(
      makeRequest("/enqueue", "POST", { from: "device-a", payload: "new-message" })
    )

    // Run cleanup
    const cleanupResp = await queue.fetch(makeRequest("/cleanup", "POST"))
    expect(cleanupResp.status).toBe(200)
    const cleanupData = (await cleanupResp.json()) as { deleted: number }
    expect(cleanupData.deleted).toBe(1)

    // Only the new message should remain
    const drainResp = await queue.fetch(makeRequest("/drain", "GET"))
    const drainData = (await drainResp.json()) as {
      messages: Array<{ payload: string }>
      count: number
    }
    expect(drainData.count).toBe(1)
    expect(drainData.messages[0]!.payload).toBe("new-message")
  })
})
