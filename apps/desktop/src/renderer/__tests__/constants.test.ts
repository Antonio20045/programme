import { describe, it, expect } from 'vitest'
import { PROVIDERS, TONES, PROVIDER_MODELS } from '../src/constants'

describe('constants', () => {
  it('exports 2 providers (Google + Anthropic)', () => {
    expect(PROVIDERS).toHaveLength(2)
    expect(PROVIDERS.map((p) => p.id)).toEqual(['google', 'anthropic'])
  })

  it('each provider has required fields', () => {
    for (const p of PROVIDERS) {
      expect(typeof p.label).toBe('string')
      expect(typeof p.sublabel).toBe('string')
      expect(typeof p.model).toBe('string')
    }
  })

  it('exports 3 tones', () => {
    expect(TONES).toHaveLength(3)
    expect(TONES.map((t) => t.id)).toEqual(['professional', 'friendly', 'concise'])
  })

  it('each tone has label and example', () => {
    for (const t of TONES) {
      expect(typeof t.label).toBe('string')
      expect(typeof t.example).toBe('string')
    }
  })

  it('exports PROVIDER_MODELS for Google and Anthropic', () => {
    expect(PROVIDER_MODELS.get('google')?.length).toBeGreaterThan(0)
    expect(PROVIDER_MODELS.get('anthropic')?.length).toBeGreaterThan(0)
    expect(PROVIDER_MODELS.get('openai')).toBeUndefined()
  })

  it('each model entry has value, label and desc', () => {
    for (const models of PROVIDER_MODELS.values()) {
      for (const m of models) {
        expect(typeof m.value).toBe('string')
        expect(typeof m.label).toBe('string')
        expect(typeof m.desc).toBe('string')
      }
    }
  })
})
