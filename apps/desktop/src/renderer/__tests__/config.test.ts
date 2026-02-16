import { describe, it, expect } from 'vitest'
import { GATEWAY_URL } from '../src/config'

describe('config', () => {
  it('exports GATEWAY_URL pointing to localhost', () => {
    expect(GATEWAY_URL).toBe('http://127.0.0.1:18789')
  })

  it('uses 127.0.0.1 not 0.0.0.0', () => {
    expect(GATEWAY_URL).toContain('127.0.0.1')
    expect(GATEWAY_URL).not.toContain('0.0.0.0')
  })
})
