/**
 * Mock helpers for Durable Object storage in tests.
 */

export class MockStorage {
  private data = new Map<string, unknown>()
  private alarm: number | null = null

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string | string[]): Promise<boolean> {
    if (Array.isArray(key)) {
      for (const k of key) {
        this.data.delete(k)
      }
      return true
    }
    return this.data.delete(key)
  }

  async list<T = unknown>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    const sorted = [...this.data.entries()].sort(([a], [b]) => a.localeCompare(b))

    for (const [key, value] of sorted) {
      if (options?.prefix && !key.startsWith(options.prefix)) continue
      result.set(key, value as T)
      if (options?.limit && result.size >= options.limit) break
    }

    return result
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm
  }

  async setAlarm(scheduledTime: number): Promise<void> {
    this.alarm = scheduledTime
  }

  // Test helper: clear all data
  clear(): void {
    this.data.clear()
    this.alarm = null
  }
}

export class MockState {
  storage: MockStorage

  constructor() {
    this.storage = new MockStorage()
  }
}
