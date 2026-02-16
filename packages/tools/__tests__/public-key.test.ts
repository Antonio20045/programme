import { describe, expect, it } from 'vitest'
import { TOOL_SIGNING_PUBLIC_KEY } from '../src/public-key'

describe('TOOL_SIGNING_PUBLIC_KEY', () => {
  it('exports a string', () => {
    expect(typeof TOOL_SIGNING_PUBLIC_KEY).toBe('string')
  })

  it('is a valid hex string (64 chars = 32 bytes) or empty placeholder', () => {
    const key: string = TOOL_SIGNING_PUBLIC_KEY
    if (key.length === 0) return // placeholder before first keygen
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})
