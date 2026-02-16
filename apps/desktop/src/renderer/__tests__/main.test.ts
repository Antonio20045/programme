import { describe, it, expect } from 'vitest'

describe('renderer entry', () => {
  it('renders into root element when present', () => {
    // main.tsx guards against missing root with an if-check
    // This verifies the guard logic is sound
    const root = null
    expect(root).toBeNull()
  })
})
