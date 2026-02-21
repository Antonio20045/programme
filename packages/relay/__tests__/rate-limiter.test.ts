import { describe, it, expect } from "vitest"
import { RateLimiter } from "../src/rate-limiter"

describe("RateLimiter", () => {
  it("allows 100 requests within 1 minute", () => {
    const limiter = new RateLimiter(60_000, 100)

    for (let i = 0; i < 100; i++) {
      const result = limiter.check("device-a")
      expect(result.allowed).toBe(true)
    }
  })

  it("blocks the 101st request", () => {
    const limiter = new RateLimiter(60_000, 100)

    for (let i = 0; i < 100; i++) {
      limiter.check("device-a")
    }

    const result = limiter.check("device-a")
    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBeGreaterThan(0)
  })

  it("tracks different devices independently", () => {
    const limiter = new RateLimiter(60_000, 100)

    for (let i = 0; i < 100; i++) {
      limiter.check("device-a")
    }

    // device-b should still be allowed
    const result = limiter.check("device-b")
    expect(result.allowed).toBe(true)
  })

  it("remove() clears state for a device", () => {
    const limiter = new RateLimiter(60_000, 100)

    for (let i = 0; i < 100; i++) {
      limiter.check("device-a")
    }

    expect(limiter.check("device-a").allowed).toBe(false)

    limiter.remove("device-a")

    expect(limiter.check("device-a").allowed).toBe(true)
  })
})
