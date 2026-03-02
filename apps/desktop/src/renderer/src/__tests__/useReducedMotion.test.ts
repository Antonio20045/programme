import { describe, it, expect } from 'vitest'
import { useReducedMotion } from '../hooks/useReducedMotion'

describe('useReducedMotion', () => {
  it('is a function', () => {
    expect(typeof useReducedMotion).toBe('function')
  })

  it('exports as named export', () => {
    expect(useReducedMotion.name).toBe('useReducedMotion')
  })
})
