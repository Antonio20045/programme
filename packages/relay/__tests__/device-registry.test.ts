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

const TEST_ENV = { JWT_SECRET: "test-secret", DEVICE_REGISTRY: {}, OFFLINE_QUEUE: {} }

function createRegistry(): DeviceRegistry {
  const state = new MockState()
  return new DeviceRegistry(state as never, TEST_ENV as never)
}

function makeRequest(path: string, method: string, body?: unknown): Request {
  const options: RequestInit = { method, headers: { "Content-Type": "application/json" } }
  if (body) options.body = JSON.stringify(body)
  return new Request(`https://do${path}`, options)
}

const DEVICE_A = "aabbccdd00112233aabbccdd00112233"
const DEVICE_B = "11223344aabbccdd11223344aabbccdd"
const KEY_A = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ=="
const KEY_B = "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQg=="

describe("DeviceRegistry", () => {
  let registry: DeviceRegistry

  beforeEach(() => {
    registry = createRegistry()
  })

  it("init-pairing returns 201 with pairingToken", async () => {
    const resp = await registry.fetch(
      makeRequest("/init-pairing", "POST", { deviceId: DEVICE_A, publicKey: KEY_A })
    )

    expect(resp.status).toBe(201)
    const data = (await resp.json()) as { pairingToken: string; expiresAt: number }
    expect(data.pairingToken).toBeDefined()
    expect(typeof data.pairingToken).toBe("string")
    expect(data.pairingToken.length).toBe(64) // 32 bytes hex
    expect(data.expiresAt).toBeGreaterThan(Date.now())
  })

  it("complete-pairing with valid token returns 200 with 2 JWTs", async () => {
    // Init pairing
    const initResp = await registry.fetch(
      makeRequest("/init-pairing", "POST", { deviceId: DEVICE_A, publicKey: KEY_A })
    )
    const { pairingToken } = (await initResp.json()) as { pairingToken: string }

    // Complete pairing
    const completeResp = await registry.fetch(
      makeRequest("/complete-pairing", "POST", {
        pairingToken,
        deviceId: DEVICE_B,
        publicKey: KEY_B,
      })
    )

    expect(completeResp.status).toBe(200)
    const data = (await completeResp.json()) as {
      tokenA: string
      tokenB: string
      deviceA: string
      deviceB: string
    }
    expect(data.tokenA).toBe(`jwt-for-${DEVICE_A}`)
    expect(data.tokenB).toBe(`jwt-for-${DEVICE_B}`)
    expect(data.deviceA).toBe(DEVICE_A)
    expect(data.deviceB).toBe(DEVICE_B)
  })

  it("complete-pairing with expired token returns 410", async () => {
    const initResp = await registry.fetch(
      makeRequest("/init-pairing", "POST", { deviceId: DEVICE_A, publicKey: KEY_A })
    )
    const { pairingToken } = (await initResp.json()) as { pairingToken: string }

    // Manipulate expiry via storage
    const state = (registry as unknown as { ctx: MockState }).ctx
    const stored = await state.storage.get<{ expiresAt: number }>(`pairing:${pairingToken}`)
    if (stored) {
      stored.expiresAt = Date.now() - 1000
      await state.storage.put(`pairing:${pairingToken}`, stored)
    }

    const resp = await registry.fetch(
      makeRequest("/complete-pairing", "POST", {
        pairingToken,
        deviceId: DEVICE_B,
        publicKey: KEY_B,
      })
    )

    expect(resp.status).toBe(410)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("TOKEN_EXPIRED")
  })

  it("complete-pairing with used token returns 409", async () => {
    const initResp = await registry.fetch(
      makeRequest("/init-pairing", "POST", { deviceId: DEVICE_A, publicKey: KEY_A })
    )
    const { pairingToken } = (await initResp.json()) as { pairingToken: string }

    // First completion succeeds
    await registry.fetch(
      makeRequest("/complete-pairing", "POST", {
        pairingToken,
        deviceId: DEVICE_B,
        publicKey: KEY_B,
      })
    )

    // Second attempt with same token
    const resp = await registry.fetch(
      makeRequest("/complete-pairing", "POST", {
        pairingToken,
        deviceId: DEVICE_B,
        publicKey: KEY_B,
      })
    )

    expect(resp.status).toBe(409)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("TOKEN_USED")
  })

  it("self-pair returns 400", async () => {
    const initResp = await registry.fetch(
      makeRequest("/init-pairing", "POST", { deviceId: DEVICE_A, publicKey: KEY_A })
    )
    const { pairingToken } = (await initResp.json()) as { pairingToken: string }

    const resp = await registry.fetch(
      makeRequest("/complete-pairing", "POST", {
        pairingToken,
        deviceId: DEVICE_A, // same device
        publicKey: KEY_B,
      })
    )

    expect(resp.status).toBe(400)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("SELF_PAIR")
  })

  it("partner/:deviceId returns correct partner", async () => {
    // Setup pairing
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

    // Query partner of A
    const resp = await registry.fetch(makeRequest(`/partner/${DEVICE_A}`, "GET"))
    expect(resp.status).toBe(200)
    const data = (await resp.json()) as { partnerId: string; partnerKey: string }
    expect(data.partnerId).toBe(DEVICE_B)
    expect(data.partnerKey).toBe(KEY_B)
  })

  it("partner for unpaired device returns 404", async () => {
    const resp = await registry.fetch(makeRequest(`/partner/${DEVICE_A}`, "GET"))
    expect(resp.status).toBe(404)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("NOT_PAIRED")
  })

  // ── Pairing Status Tests ──────────────────────────────────────────

  it("pairing-status before completion returns paired=false", async () => {
    const initResp = await registry.fetch(
      makeRequest("/init-pairing", "POST", { deviceId: DEVICE_A, publicKey: KEY_A })
    )
    const { pairingToken } = (await initResp.json()) as { pairingToken: string }

    const statusResp = await registry.fetch(
      makeRequest(`/pairing-status/${pairingToken}`, "GET")
    )
    expect(statusResp.status).toBe(200)
    const data = (await statusResp.json()) as { paired: boolean; expiresAt?: number }
    expect(data.paired).toBe(false)
    expect(data.expiresAt).toBeDefined()
  })

  it("pairing-status after completion returns paired=true with jwt and partner info", async () => {
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

    const statusResp = await registry.fetch(
      makeRequest(`/pairing-status/${pairingToken}`, "GET")
    )
    expect(statusResp.status).toBe(200)
    const data = (await statusResp.json()) as {
      paired: boolean
      jwt?: string
      partnerDeviceId?: string
      partnerPublicKey?: string
    }
    expect(data.paired).toBe(true)
    expect(data.jwt).toBe(`jwt-for-${DEVICE_A}`)
    expect(data.partnerDeviceId).toBe(DEVICE_B)
    expect(data.partnerPublicKey).toBe(KEY_B)
  })

  it("pairing-status second poll returns paired=false (one-time retrieval)", async () => {
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

    // First poll returns result
    await registry.fetch(makeRequest(`/pairing-status/${pairingToken}`, "GET"))

    // Second poll: result already consumed
    const statusResp = await registry.fetch(
      makeRequest(`/pairing-status/${pairingToken}`, "GET")
    )
    expect(statusResp.status).toBe(200)
    const data = (await statusResp.json()) as { paired: boolean; jwt?: string }
    expect(data.paired).toBe(false)
    expect(data.jwt).toBeUndefined()
  })

  it("pairing-status unknown token returns 404", async () => {
    const resp = await registry.fetch(
      makeRequest("/pairing-status/0000000000000000000000000000000000000000000000000000000000000000", "GET")
    )
    expect(resp.status).toBe(404)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("TOKEN_NOT_FOUND")
  })

  it("pairing-status expired token returns 410", async () => {
    const initResp = await registry.fetch(
      makeRequest("/init-pairing", "POST", { deviceId: DEVICE_A, publicKey: KEY_A })
    )
    const { pairingToken } = (await initResp.json()) as { pairingToken: string }

    // Manipulate expiry
    const state = (registry as unknown as { ctx: MockState }).ctx
    const stored = await state.storage.get<{ expiresAt: number; used: boolean }>(`pairing:${pairingToken}`)
    if (stored) {
      stored.expiresAt = Date.now() - 1000
      await state.storage.put(`pairing:${pairingToken}`, stored)
    }

    const resp = await registry.fetch(
      makeRequest(`/pairing-status/${pairingToken}`, "GET")
    )
    expect(resp.status).toBe(410)
    const data = (await resp.json()) as { code: string }
    expect(data.code).toBe("TOKEN_EXPIRED")
  })

  // ── Unpair Tests ──────────────────────────────────────────────────

  it("unpair deletes both directions", async () => {
    // Setup pairing
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

    // Unpair from A's side
    const unpairResp = await registry.fetch(makeRequest(`/pair/${DEVICE_A}`, "DELETE"))
    expect(unpairResp.status).toBe(200)

    // Both should be unpaired now
    const respA = await registry.fetch(makeRequest(`/partner/${DEVICE_A}`, "GET"))
    expect(respA.status).toBe(404)

    const respB = await registry.fetch(makeRequest(`/partner/${DEVICE_B}`, "GET"))
    expect(respB.status).toBe(404)
  })
})
