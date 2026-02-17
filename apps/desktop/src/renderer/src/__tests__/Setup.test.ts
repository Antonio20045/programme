import { describe, it, expect } from 'vitest'
import Setup from '../pages/Setup'

describe('Setup', () => {
  it('is a function component', () => {
    expect(typeof Setup).toBe('function')
  })

  it('exports default function named Setup', () => {
    expect(Setup.name).toBe('Setup')
  })
})
