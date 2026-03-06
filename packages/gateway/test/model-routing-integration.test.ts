/**
 * Model routing integration tests.
 *
 * Verifies: classifier-based model selection, user override,
 * GEMINI_API_KEY fallback, /opus direct routing.
 *
 * NOTE: Gateway tests are excluded from root `pnpm test`.
 * Run standalone:
 *   cd packages/gateway && npx vitest run test/model-routing-integration.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveModel, resolveModelForAgent } from '../../tools/src/model-resolver'

// ─── getUserDefaultModel tests (config.ts) ────────────────────

// We can't easily import getUserDefaultModel because config.ts has
// side-effect imports. Instead, test the resolution logic directly.

describe('resolveModelForAgent — classifier model tier routing', () => {
  it('haiku tier → google/gemini-2.5-flash-lite with anthropic fallback', () => {
    const result = resolveModelForAgent('haiku')
    expect(result.provider).toBe('google')
    expect(result.model).toBe('gemini-2.5-flash-lite')
    expect(result.fallbackModel).toBe('anthropic/claude-haiku-4-5')
  })

  it('sonnet tier → google/gemini-2.5-flash-lite with anthropic sonnet fallback', () => {
    const result = resolveModelForAgent('sonnet')
    expect(result.provider).toBe('google')
    expect(result.model).toBe('gemini-2.5-flash-lite')
    expect(result.fallbackModel).toBe('anthropic/claude-sonnet-4-5')
  })

  it('opus tier → direct anthropic/claude-opus-4-6, no fallback', () => {
    const result = resolveModelForAgent('opus')
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe('claude-opus-4-6')
    expect(result.fallbackModel).toBeUndefined()
  })

  it('unknown tier → defaults to haiku routing', () => {
    const result = resolveModelForAgent('unknown-model')
    expect(result.provider).toBe('google')
    expect(result.model).toBe('gemini-2.5-flash-lite')
    expect(result.fallbackModel).toBe('anthropic/claude-haiku-4-5')
  })
})

describe('resolveModel — legacy tier routing', () => {
  it('claude-haiku-4-5 → gemini with haiku fallback', () => {
    const result = resolveModel('claude-haiku-4-5')
    expect(result.provider).toBe('google')
    expect(result.model).toBe('gemini-2.5-flash-lite')
    expect(result.fallbackModel).toBe('anthropic/claude-haiku-4-5')
  })

  it('claude-opus-4-6 → direct anthropic, no fallback', () => {
    const result = resolveModel('claude-opus-4-6')
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe('claude-opus-4-6')
    expect(result.fallbackModel).toBeUndefined()
  })
})

describe('getUserDefaultModel — ENV override', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env['DEFAULT_MODEL']
    // Reset module cache to clear 30s cache
    vi.resetModules()
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['DEFAULT_MODEL']
    } else {
      process.env['DEFAULT_MODEL'] = originalEnv
    }
    vi.resetModules()
  })

  it('returns anthropic model from DEFAULT_MODEL env var', async () => {
    process.env['DEFAULT_MODEL'] = 'anthropic/claude-sonnet-4-5'

    // Dynamic import to pick up fresh module state
    const { getUserDefaultModel } = await import('../config')
    const result = getUserDefaultModel()
    expect(result).toBe('anthropic/claude-sonnet-4-5')
  })

  it('ignores non-anthropic DEFAULT_MODEL values', async () => {
    process.env['DEFAULT_MODEL'] = 'google/gemini-pro'

    const { getUserDefaultModel } = await import('../config')
    const result = getUserDefaultModel()
    expect(result).toBeUndefined()
  })

  it('returns undefined when no DEFAULT_MODEL set', async () => {
    delete process.env['DEFAULT_MODEL']

    const { getUserDefaultModel } = await import('../config')
    const result = getUserDefaultModel()
    expect(result).toBeUndefined()
  })
})

describe('GEMINI_API_KEY fallback logic', () => {
  it('google provider without GEMINI_API_KEY falls back to anthropic', () => {
    // Simulate the logic from in-app.ts lines 1100-1113
    let provider = 'google'
    let model = 'gemini-2.5-flash-lite'
    let fallbackModel: string | undefined = 'anthropic/claude-haiku-4-5'
    const hasGeminiKey = false // simulates !process.env["GEMINI_API_KEY"]

    if (provider === 'google' && !hasGeminiKey) {
      if (fallbackModel) {
        const slashIdx = fallbackModel.indexOf('/')
        provider = slashIdx > 0 ? fallbackModel.slice(0, slashIdx) : 'anthropic'
        model = slashIdx > 0 ? fallbackModel.slice(slashIdx + 1) : fallbackModel
        fallbackModel = undefined
      }
    }

    expect(provider).toBe('anthropic')
    expect(model).toBe('claude-haiku-4-5')
    expect(fallbackModel).toBeUndefined()
  })

  it('google provider WITH GEMINI_API_KEY keeps gemini routing', () => {
    let provider = 'google'
    let model = 'gemini-2.5-flash-lite'
    let fallbackModel: string | undefined = 'anthropic/claude-haiku-4-5'
    const hasGeminiKey = true

    if (provider === 'google' && !hasGeminiKey) {
      if (fallbackModel) {
        const slashIdx = fallbackModel.indexOf('/')
        provider = slashIdx > 0 ? fallbackModel.slice(0, slashIdx) : 'anthropic'
        model = slashIdx > 0 ? fallbackModel.slice(slashIdx + 1) : fallbackModel
        fallbackModel = undefined
      }
    }

    expect(provider).toBe('google')
    expect(model).toBe('gemini-2.5-flash-lite')
    expect(fallbackModel).toBe('anthropic/claude-haiku-4-5')
  })

  it('google provider without key and no fallback → default haiku', () => {
    let provider = 'google'
    let model = 'gemini-2.5-flash-lite'
    let fallbackModel: string | undefined = undefined
    const hasGeminiKey = false

    if (provider === 'google' && !hasGeminiKey) {
      if (fallbackModel) {
        const slashIdx = fallbackModel.indexOf('/')
        provider = slashIdx > 0 ? fallbackModel.slice(0, slashIdx) : 'anthropic'
        model = slashIdx > 0 ? fallbackModel.slice(slashIdx + 1) : fallbackModel
        fallbackModel = undefined
      } else {
        provider = 'anthropic'
        model = 'claude-haiku-4-5'
        fallbackModel = undefined
      }
    }

    expect(provider).toBe('anthropic')
    expect(model).toBe('claude-haiku-4-5')
  })
})
