import type { RateLimitResult } from "./types"

export class RateLimiter {
  private windows = new Map<string, number[]>()
  private readonly windowMs: number
  private readonly maxRequests: number

  constructor(windowMs = 60_000, maxRequests = 100) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests
  }

  check(deviceId: string): RateLimitResult {
    const now = Date.now()
    const cutoff = now - this.windowMs

    let timestamps = this.windows.get(deviceId)
    if (!timestamps) {
      timestamps = []
      this.windows.set(deviceId, timestamps)
    }

    // Remove expired timestamps
    const filtered = timestamps.filter((t) => t > cutoff)
    this.windows.set(deviceId, filtered)

    if (filtered.length >= this.maxRequests) {
      const oldest = filtered[0]!
      const retryAfter = Math.ceil((oldest + this.windowMs - now) / 1000)
      return { allowed: false, retryAfter }
    }

    filtered.push(now)
    return { allowed: true }
  }

  remove(deviceId: string): void {
    this.windows.delete(deviceId)
  }
}
