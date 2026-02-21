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

// Mock jwt module
vi.mock("../src/jwt", () => ({
  signJwt: vi.fn(async (payload: { sub: string; pair: string }) => {
    return `jwt-for-${payload.sub}`
  }),
}))

import { DeviceRegistry } from "../src/device-registry"
import type { DevicePushInfo } from "../src/types"

const TEST_ENV = { JWT_SECRET: "test-secret", DEVICE_REGISTRY: {}, OFFLINE_QUEUE: {} }

const DEVICE_A = "aabbccdd00112233aabbccdd00112233"
const DEVICE_B = "11223344aabbccdd11223344aabbccdd"
const KEY_A = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ=="
const KEY_B = "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQg=="
const VALID_PUSH_TOKEN = "ExponentPushToken[abc123xyz]"

function createRegistry(): DeviceRegistry {
  const state = new MockState()
  return new DeviceRegistry(state as never, TEST_ENV as never)
}

function makeRequest(path: string, method: string, body?: unknown): Request {
  const options: RequestInit = { method, headers: { "Content-Type": "application/json" } }
  if (body) options.body = JSON.stringify(body)
  return new Request(`https://do${path}`, options)
}

async function setupPairing(registry: DeviceRegistry): Promise<void> {
  const initResp = await registry.fetch(
    makeRequest("/init-pairing", "POST", { deviceId: DEVICE_A, publicKey: KEY_A })
  )
  const { pairingToken } = (await initResp.json()) as { pairingToken: string }
  await registry.fetch(
    makeRequest("/complete-pairing", "POST", {
      pairingToken,
      deviceId: DEVICE_B,
      publicKey: KEY_B,
    })
  )
}

describe("Push Token CRUD", () => {
  let registry: DeviceRegistry

  beforeEach(() => {
    registry = createRegistry()
  })

  it("stores push token for paired device", async () => {
    await setupPairing(registry)

    const resp = await registry.fetch(
      makeRequest(`/push-token/${DEVICE_A}`, "PUT", {
        token: VALID_PUSH_TOKEN,
        platform: "ios",
      })
    )

    expect(resp.status).toBe(200)
    const data = (await resp.json()) as { ok: boolean }
    expect(data.ok).toBe(true)
  })

  it("retrieves stored push token", async () => {
    await setupPairing(registry)

    await registry.fetch(
      makeRequest(`/push-token/${DEVICE_A}`, "PUT", {
        token: VALID_PUSH_TOKEN,
        platform: "android",
      })
    )

    const resp = await registry.fetch(makeRequest(`/push-token/${DEVICE_A}`, "GET"))
    expect(resp.status).toBe(200)
    const data = (await resp.json()) as DevicePushInfo
    expect(data.token).toBe(VALID_PUSH_TOKEN)
    expect(data.platform).toBe("android")
    expect(data.registeredAt).toBeGreaterThan(0)
  })

  it("deletes push token", async () => {
    await setupPairing(registry)

    await registry.fetch(
      makeRequest(`/push-token/${DEVICE_A}`, "PUT", {
        token: VALID_PUSH_TOKEN,
        platform: "ios",
      })
    )

    const deleteResp = await registry.fetch(makeRequest(`/push-token/${DEVICE_A}`, "DELETE"))
    expect(deleteResp.status).toBe(200)

    const getResp = await registry.fetch(makeRequest(`/push-token/${DEVICE_A}`, "GET"))
    expect(getResp.status).toBe(404)
  })

  it("returns 404 for device without push token", async () => {
    await setupPairing(registry)

    const resp = await registry.fetch(makeRequest(`/push-token/${DEVICE_A}`, "GET"))
    expect(resp.status).toBe(404)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("NOT_FOUND")
  })

  it("rejects push token for unpaired device", async () => {
    const resp = await registry.fetch(
      makeRequest(`/push-token/${DEVICE_A}`, "PUT", {
        token: VALID_PUSH_TOKEN,
        platform: "ios",
      })
    )

    expect(resp.status).toBe(403)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("NOT_PAIRED")
  })

  it("rejects invalid token format", async () => {
    await setupPairing(registry)

    const resp = await registry.fetch(
      makeRequest(`/push-token/${DEVICE_A}`, "PUT", {
        token: "invalid-token-format",
        platform: "ios",
      })
    )

    expect(resp.status).toBe(400)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("INVALID_TOKEN")
  })

  it("rejects invalid platform", async () => {
    await setupPairing(registry)

    const resp = await registry.fetch(
      makeRequest(`/push-token/${DEVICE_A}`, "PUT", {
        token: VALID_PUSH_TOKEN,
        platform: "windows",
      })
    )

    expect(resp.status).toBe(400)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("INVALID_PLATFORM")
  })

  it("rejects invalid deviceId format", async () => {
    const resp = await registry.fetch(
      makeRequest("/push-token/invalid!", "PUT", {
        token: VALID_PUSH_TOKEN,
        platform: "ios",
      })
    )

    expect(resp.status).toBe(400)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("INVALID_DEVICE_ID")
  })

  it("overwrites existing push token (idempotent PUT)", async () => {
    await setupPairing(registry)

    const newToken = "ExponentPushToken[newtoken456]"

    await registry.fetch(
      makeRequest(`/push-token/${DEVICE_A}`, "PUT", {
        token: VALID_PUSH_TOKEN,
        platform: "ios",
      })
    )

    await registry.fetch(
      makeRequest(`/push-token/${DEVICE_A}`, "PUT", {
        token: newToken,
        platform: "android",
      })
    )

    const resp = await registry.fetch(makeRequest(`/push-token/${DEVICE_A}`, "GET"))
    const data = (await resp.json()) as DevicePushInfo
    expect(data.token).toBe(newToken)
    expect(data.platform).toBe("android")
  })
})

describe("Unpair deletes push tokens", () => {
  it("removes push tokens for both devices on unpair", async () => {
    const registry = createRegistry()
    await setupPairing(registry)

    // Set push tokens for both devices
    await registry.fetch(
      makeRequest(`/push-token/${DEVICE_A}`, "PUT", {
        token: VALID_PUSH_TOKEN,
        platform: "ios",
      })
    )
    await registry.fetch(
      makeRequest(`/push-token/${DEVICE_B}`, "PUT", {
        token: "ExponentPushToken[device_b_token]",
        platform: "android",
      })
    )

    // Unpair
    await registry.fetch(makeRequest(`/pair/${DEVICE_A}`, "DELETE"))

    // Both push tokens should be gone
    const respA = await registry.fetch(makeRequest(`/push-token/${DEVICE_A}`, "GET"))
    expect(respA.status).toBe(404)

    const respB = await registry.fetch(makeRequest(`/push-token/${DEVICE_B}`, "GET"))
    expect(respB.status).toBe(404)
  })
})

describe("sendPushNotification", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("sends correct Expo API request", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)

    const { sendPushNotification } = await import("../src/push")

    const result = await sendPushNotification({
      token: VALID_PUSH_TOKEN,
      platform: "ios",
      registeredAt: Date.now(),
    })

    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledOnce()

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://exp.host/--/api/v2/push/send")
    expect(options.method).toBe("POST")

    const body = JSON.parse(options.body as string) as Record<string, unknown>
    expect(body.to).toBe(VALID_PUSH_TOKEN)
    expect(body.title).toBe("KI-Assistent")
    expect(body.sound).toBe("default")
    expect(body.badge).toBe(1)

    vi.unstubAllGlobals()
  })

  it("Zero Knowledge: push body contains NO message content or metadata", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)

    const { sendPushNotification } = await import("../src/push")

    await sendPushNotification({
      token: VALID_PUSH_TOKEN,
      platform: "ios",
      registeredAt: Date.now(),
    })

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string) as Record<string, unknown>

    // Must NOT contain any of these fields
    const forbidden = ["content", "message", "text", "deviceId", "from", "payload", "data"]
    for (const key of forbidden) {
      expect(body).not.toHaveProperty(key)
    }

    vi.unstubAllGlobals()
  })

  it("returns false on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")))

    const { sendPushNotification } = await import("../src/push")

    const result = await sendPushNotification({
      token: VALID_PUSH_TOKEN,
      platform: "android",
      registeredAt: Date.now(),
    })

    expect(result).toBe(false)
    vi.unstubAllGlobals()
  })

  it("returns false on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const { sendPushNotification } = await import("../src/push")

    const result = await sendPushNotification({
      token: VALID_PUSH_TOKEN,
      platform: "ios",
      registeredAt: Date.now(),
    })

    expect(result).toBe(false)
    vi.unstubAllGlobals()
  })
})
