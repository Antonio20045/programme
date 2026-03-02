import { describe, expect, it } from 'vitest'
import { CAPABILITIES, resolveDisabledTools } from '../src/capabilities'

describe('CAPABILITIES', () => {
  it('has unique IDs', () => {
    const ids = CAPABILITIES.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no duplicate tool names across capabilities', () => {
    const seen = new Map<string, string>()
    for (const cap of CAPABILITIES) {
      for (const tool of cap.tools) {
        if (seen.has(tool)) {
          throw new Error(`Tool "${tool}" appears in both "${seen.get(tool)}" and "${cap.id}"`)
        }
        seen.set(tool, cap.id)
      }
    }
  })

  it('every capability has at least one tool', () => {
    for (const cap of CAPABILITIES) {
      expect(cap.tools.length).toBeGreaterThan(0)
    }
  })
})

describe('resolveDisabledTools', () => {
  it('returns empty set for empty input', () => {
    const result = resolveDisabledTools([])
    expect(result.size).toBe(0)
  })

  it('resolves a single capability to its tools', () => {
    const result = resolveDisabledTools(['gmail'])
    expect(result.has('gmail')).toBe(true)
    expect(result.has('connect-google')).toBe(true)
    expect(result.size).toBe(2)
  })

  it('resolves multiple capabilities', () => {
    const result = resolveDisabledTools(['shell', 'browser'])
    expect(result.has('shell')).toBe(true)
    expect(result.has('browser')).toBe(true)
    expect(result.size).toBe(2)
  })

  it('ignores unknown capability IDs', () => {
    const result = resolveDisabledTools(['nonexistent', 'shell'])
    expect(result.has('shell')).toBe(true)
    expect(result.size).toBe(1)
  })

  it('resolves devices capability to all its tools', () => {
    const result = resolveDisabledTools(['devices'])
    expect(result.has('clipboard')).toBe(true)
    expect(result.has('screenshot')).toBe(true)
    expect(result.has('app-launcher')).toBe(true)
    expect(result.has('media-control')).toBe(true)
    expect(result.has('system-info')).toBe(true)
    expect(result.has('git-tools')).toBe(true)
    expect(result.size).toBe(6)
  })
})
