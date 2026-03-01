import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveModel, resolveModelForAgent } from '../src/model-resolver'
import type { ResolvedModel } from '../src/model-resolver'
import { assertNoEval } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/model-resolver.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// resolveModel — Haiku
// ---------------------------------------------------------------------------

describe('resolveModel — Haiku', () => {
  const result: ResolvedModel = resolveModel('claude-haiku-4-5')

  it('routes to google provider', () => {
    expect(result.provider).toBe('google')
  })

  it('uses gemini-2.5-flash-lite as model', () => {
    expect(result.model).toBe('gemini-2.5-flash-lite')
  })

  it('sets anthropic/claude-haiku-4-5 as fallback', () => {
    expect(result.fallbackModel).toBe('anthropic/claude-haiku-4-5')
  })
})

// ---------------------------------------------------------------------------
// resolveModel — Sonnet
// ---------------------------------------------------------------------------

describe('resolveModel — Sonnet', () => {
  const result: ResolvedModel = resolveModel('claude-sonnet-4-5')

  it('routes to google provider', () => {
    expect(result.provider).toBe('google')
  })

  it('uses gemini-2.5-flash-lite as model', () => {
    expect(result.model).toBe('gemini-2.5-flash-lite')
  })

  it('sets anthropic/claude-sonnet-4-5 as fallback', () => {
    expect(result.fallbackModel).toBe('anthropic/claude-sonnet-4-5')
  })
})

// ---------------------------------------------------------------------------
// resolveModel — Opus
// ---------------------------------------------------------------------------

describe('resolveModel — Opus', () => {
  const result: ResolvedModel = resolveModel('claude-opus-4-6')

  it('routes to anthropic provider', () => {
    expect(result.provider).toBe('anthropic')
  })

  it('uses claude-opus-4-6 as model', () => {
    expect(result.model).toBe('claude-opus-4-6')
  })

  it('has no fallback', () => {
    expect(result.fallbackModel).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resolveModel — Unknown tier
// ---------------------------------------------------------------------------

describe('resolveModel — Unknown tier', () => {
  const result: ResolvedModel = resolveModel('claude-unknown-99')

  it('does not throw', () => {
    expect(() => resolveModel('claude-unknown-99')).not.toThrow()
  })

  it('routes to google provider', () => {
    expect(result.provider).toBe('google')
  })

  it('uses gemini-2.5-flash-lite as model', () => {
    expect(result.model).toBe('gemini-2.5-flash-lite')
  })

  it('has no fallback (no mapping exists)', () => {
    expect(result.fallbackModel).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resolveModelForAgent
// ---------------------------------------------------------------------------

describe('resolveModelForAgent', () => {
  it('maps "haiku" correctly', () => {
    const result = resolveModelForAgent('haiku')
    expect(result.provider).toBe('google')
    expect(result.model).toBe('gemini-2.5-flash-lite')
    expect(result.fallbackModel).toBe('anthropic/claude-haiku-4-5')
  })

  it('maps "sonnet" correctly', () => {
    const result = resolveModelForAgent('sonnet')
    expect(result.provider).toBe('google')
    expect(result.model).toBe('gemini-2.5-flash-lite')
    expect(result.fallbackModel).toBe('anthropic/claude-sonnet-4-5')
  })

  it('maps "opus" correctly', () => {
    const result = resolveModelForAgent('opus')
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe('claude-opus-4-6')
    expect(result.fallbackModel).toBeUndefined()
  })

  it('defaults unknown short name to haiku tier', () => {
    const result = resolveModelForAgent('unknown-model')
    expect(result).toEqual(resolveModelForAgent('haiku'))
  })

  it('is consistent with resolveModel for each tier', () => {
    expect(resolveModelForAgent('haiku')).toEqual(resolveModel('claude-haiku-4-5'))
    expect(resolveModelForAgent('sonnet')).toEqual(resolveModel('claude-sonnet-4-5'))
    expect(resolveModelForAgent('opus')).toEqual(resolveModel('claude-opus-4-6'))
  })
})

// ---------------------------------------------------------------------------
// Routing invariants
// ---------------------------------------------------------------------------

describe('routing invariants', () => {
  it('haiku never routes directly to anthropic', () => {
    expect(resolveModel('claude-haiku-4-5').provider).not.toBe('anthropic')
  })

  it('sonnet never routes directly to anthropic', () => {
    expect(resolveModel('claude-sonnet-4-5').provider).not.toBe('anthropic')
  })

  it('opus never routes to google', () => {
    expect(resolveModel('claude-opus-4-6').provider).not.toBe('google')
  })

  it('opus never has a fallback', () => {
    expect(resolveModel('claude-opus-4-6').fallbackModel).toBeUndefined()
  })

  it('haiku and sonnet always have a fallback', () => {
    expect(resolveModel('claude-haiku-4-5').fallbackModel).toBeDefined()
    expect(resolveModel('claude-sonnet-4-5').fallbackModel).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

describe('security', () => {
  it('contains no ev' + 'al or dynamic code execution patterns', () => {
    assertNoEval(SOURCE_CODE)
  })

  it('contains no fetch calls', () => {
    const fetchPattern = new RegExp(['\\bfe', 'tch\\s*\\('].join(''))
    expect(SOURCE_CODE).not.toMatch(fetchPattern)
  })

  it('has no mutable module-level state (no let/var at top level)', () => {
    // Match lines starting with let or var (not inside functions/blocks)
    // Module-level = lines that start with let/var after optional whitespace
    const lines = SOURCE_CODE.split('\n')
    for (const line of lines) {
      const trimmed = line.trimStart()
      if (trimmed.startsWith('let ') || trimmed.startsWith('var ')) {
        // Allow inside functions (indented)
        const indent = line.length - trimmed.length
        expect(indent, `Mutable module-level state: ${trimmed}`).toBeGreaterThan(0)
      }
    }
  })
})
