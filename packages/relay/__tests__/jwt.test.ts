import { describe, it, expect } from "vitest"
import { signJwt, verifyJwt } from "../src/jwt"
import type { JwtPayload } from "../src/types"

const SECRET = "test-secret-key-for-jwt-testing"

function makePayload(overrides?: Partial<JwtPayload>): JwtPayload {
  const now = Math.floor(Date.now() / 1000)
  return {
    sub: "aabbccdd00112233aabbccdd00112233",
    pair: "11223344aabbccdd11223344aabbccdd",
    iat: now,
    exp: now + 3600,
    ...overrides,
  }
}

describe("JWT", () => {
  it("sign + verify roundtrip returns correct claims", async () => {
    const payload = makePayload()
    const token = await signJwt(payload, SECRET)
    const result = await verifyJwt(token, SECRET)

    expect(result).not.toBeNull()
    expect(result!.sub).toBe(payload.sub)
    expect(result!.pair).toBe(payload.pair)
    expect(result!.iat).toBe(payload.iat)
    expect(result!.exp).toBe(payload.exp)
  })

  it("rejects expired token", async () => {
    const payload = makePayload({ exp: Math.floor(Date.now() / 1000) - 100 })
    const token = await signJwt(payload, SECRET)
    const result = await verifyJwt(token, SECRET)

    expect(result).toBeNull()
  })

  it("rejects manipulated payload", async () => {
    const payload = makePayload()
    const token = await signJwt(payload, SECRET)

    // Manipulate the payload part
    const parts = token.split(".")
    const tamperedPayload = btoa(JSON.stringify({ ...payload, sub: "tampered" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`

    const result = await verifyJwt(tamperedToken, SECRET)
    expect(result).toBeNull()
  })

  it("rejects manipulated signature", async () => {
    const payload = makePayload()
    const token = await signJwt(payload, SECRET)

    const parts = token.split(".")
    const tamperedToken = `${parts[0]}.${parts[1]}.invalidSignatureHere`

    const result = await verifyJwt(tamperedToken, SECRET)
    expect(result).toBeNull()
  })

  it("rejects wrong secret", async () => {
    const payload = makePayload()
    const token = await signJwt(payload, SECRET)
    const result = await verifyJwt(token, "wrong-secret")

    expect(result).toBeNull()
  })

  it("rejects malformed token with 2 parts", async () => {
    const result = await verifyJwt("header.payload", SECRET)
    expect(result).toBeNull()
  })

  it("rejects malformed token with 4 parts", async () => {
    const result = await verifyJwt("a.b.c.d", SECRET)
    expect(result).toBeNull()
  })

  it("rejects token with missing required fields", async () => {
    // Sign a token with incomplete payload (missing pair, iat, exp)
    const payload = { sub: "abc" } as unknown as JwtPayload
    const token = await signJwt(payload, SECRET)
    const result = await verifyJwt(token, SECRET)

    expect(result).toBeNull()
  })
})
