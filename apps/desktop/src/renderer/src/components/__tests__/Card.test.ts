import { describe, it, expect, vi } from 'vitest'

vi.mock('framer-motion', () => ({
  motion: {
    div: (props: Record<string, unknown>) => ({ type: 'div', props }),
  },
}))

vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}))

import Card from '../ui/Card'

describe('Card', () => {
  it('is a function component', () => {
    expect(typeof Card).toBe('function')
  })

  it('renders with default styling', () => {
    const result = Card({ children: 'Content' })
    const json = JSON.stringify(result)
    expect(json).toContain('rounded-xl')
    expect(json).toContain('border-edge')
    expect(json).toContain('bg-surface-alt')
    expect(json).toContain('shadow-sm')
    expect(json).toContain('Content')
  })

  it('has hover animation by default', () => {
    const result = Card({ children: 'Hover me' })
    const json = JSON.stringify(result)
    expect(json).toContain('whileHover')
  })

  it('disables hover animation when hover=false', () => {
    const result = Card({ hover: false, children: 'Static' })
    const json = JSON.stringify(result)
    // whileHover should not have the y value
    expect(json).not.toContain('"y":-2')
  })

  it('merges custom className', () => {
    const result = Card({ className: 'p-4', children: 'Padded' })
    const json = JSON.stringify(result)
    expect(json).toContain('p-4')
  })
})
