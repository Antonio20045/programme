import { describe, it, expect } from 'vitest'
import Settings from '../pages/Settings'

describe('Settings', () => {
  it('is a function component', () => {
    expect(typeof Settings).toBe('function')
  })

  it('exports a default function named Settings', () => {
    expect(Settings.name).toBe('Settings')
  })
})
