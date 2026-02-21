import { DurableObject } from "cloudflare:workers"
import type { Env, QueuedMessage, ErrorResponse } from "./types"

const MAX_QUEUE_SIZE = 1000
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export class OfflineQueue extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === "POST" && path === "/enqueue") {
      return this.enqueue(request)
    }
    if (request.method === "GET" && path === "/drain") {
      return this.drain()
    }
    if (request.method === "POST" && path === "/cleanup") {
      return this.cleanup()
    }

    return jsonResponse({ error: "Not found", code: "NOT_FOUND" } satisfies ErrorResponse, 404)
  }

  private async enqueue(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON", code: "INVALID_JSON" } satisfies ErrorResponse, 400)
    }

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).from !== "string" ||
      typeof (body as Record<string, unknown>).payload !== "string"
    ) {
      return jsonResponse({ error: "Missing fields", code: "INVALID_BODY" } satisfies ErrorResponse, 400)
    }

    const { from, payload } = body as { from: string; payload: string }

    // Check queue size
    const existing = await this.ctx.storage.list({ prefix: "msg:" })
    if (existing.size >= MAX_QUEUE_SIZE) {
      return jsonResponse({ error: "Queue full", code: "QUEUE_FULL" } satisfies ErrorResponse, 429)
    }

    const now = Date.now()
    const timestampPadded = now.toString().padStart(15, "0")
    const randomBytes = new Uint8Array(8)
    crypto.getRandomValues(randomBytes)
    const randomHex = Array.from(randomBytes, (b) => b.toString(16).padStart(2, "0")).join("")
    const key = `msg:${timestampPadded}:${randomHex}`

    const message: QueuedMessage = {
      from,
      payload,
      storedAt: now,
      size: payload.length,
    }

    await this.ctx.storage.put(key, message)

    // Ensure alarm is set for cleanup
    const currentAlarm = await this.ctx.storage.getAlarm()
    if (currentAlarm === null) {
      await this.ctx.storage.setAlarm(now + CLEANUP_INTERVAL_MS)
    }

    return jsonResponse({ ok: true }, 201)
  }

  private async drain(): Promise<Response> {
    const entries = await this.ctx.storage.list<QueuedMessage>({ prefix: "msg:" })

    // Keys are lexicographically sorted = FIFO order
    const messages: Array<{ from: string; payload: string }> = []
    const keysToDelete: string[] = []

    for (const [key, msg] of entries) {
      messages.push({ from: msg.from, payload: msg.payload })
      keysToDelete.push(key)
    }

    // Delete all drained messages
    if (keysToDelete.length > 0) {
      await this.ctx.storage.delete(keysToDelete)
    }

    return jsonResponse({ messages, count: messages.length }, 200)
  }

  private async cleanup(): Promise<Response> {
    const cutoff = Date.now() - MAX_AGE_MS
    const entries = await this.ctx.storage.list<QueuedMessage>({ prefix: "msg:" })

    const keysToDelete: string[] = []
    for (const [key, msg] of entries) {
      if (msg.storedAt < cutoff) {
        keysToDelete.push(key)
      }
    }

    if (keysToDelete.length > 0) {
      await this.ctx.storage.delete(keysToDelete)
    }

    return jsonResponse({ deleted: keysToDelete.length }, 200)
  }

  async alarm(): Promise<void> {
    await this.cleanup()

    // Re-schedule if there are still messages
    const remaining = await this.ctx.storage.list({ prefix: "msg:", limit: 1 })
    if (remaining.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS)
    }
  }
}
