import { describe, it, expect } from 'vitest'
import Spinner from '../ui/Spinner'

describe('Spinner', () => {
  it('is a function component', () => {
    expect(typeof Spinner).toBe('function')
  })

  it('exports a default function named Spinner', () => {
    expect(Spinner.name).toBe('Spinner')
  })

  it('accepts size prop without error', () => {
    // Verify the component can be called with each size variant
    expect(() => Spinner({ size: 'sm' })).not.toThrow()
    expect(() => Spinner({ size: 'md' })).not.toThrow()
    expect(() => Spinner({ size: 'lg' })).not.toThrow()
  })

  it('defaults to sm when no size provided', () => {
    expect(() => Spinner({})).not.toThrow()
  })
})
