import { describe, it, expect } from 'vitest'
import { PROVIDERS, TONES, API_KEY_HELP_URLS, PROVIDER_MODELS } from '../src/constants'

describe('constants', () => {
  it('exports 3 providers', () => {
    expect(PROVIDERS).toHaveLength(3)
    expect(PROVIDERS.map((p) => p.id)).toEqual(['anthropic', 'openai', 'google'])
  })

  it('each provider has required fields', () => {
    for (const p of PROVIDERS) {
      expect(typeof p.label).toBe('string')
      expect(typeof p.sublabel).toBe('string')
      expect(typeof p.model).toBe('string')
      expect(typeof p.placeholder).toBe('string')
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

  it('exports API_KEY_HELP_URLS for all providers', () => {
    expect(API_KEY_HELP_URLS['anthropic']).toContain('anthropic.com')
    expect(API_KEY_HELP_URLS['openai']).toContain('openai.com')
    expect(API_KEY_HELP_URLS['google']).toContain('google.com')
  })

  it('exports PROVIDER_MODELS for all providers', () => {
    expect(PROVIDER_MODELS['anthropic']?.length).toBeGreaterThan(0)
    expect(PROVIDER_MODELS['openai']?.length).toBeGreaterThan(0)
    expect(PROVIDER_MODELS['google']?.length).toBeGreaterThan(0)
  })

  it('each model entry has value, label and desc', () => {
    for (const models of Object.values(PROVIDER_MODELS)) {
      for (const m of models) {
        expect(typeof m.value).toBe('string')
        expect(typeof m.label).toBe('string')
        expect(typeof m.desc).toBe('string')
      }
    }
  })
})
