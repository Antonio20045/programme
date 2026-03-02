import { describe, it, expect, vi } from 'vitest'

vi.mock('framer-motion', () => ({
  motion: {
    div: (props: Record<string, unknown>) => ({ type: 'div', props }),
    h2: (props: Record<string, unknown>) => ({ type: 'h2', props }),
    p: (props: Record<string, unknown>) => ({ type: 'p', props }),
    button: (props: Record<string, unknown>) => ({ type: 'button', props }),
  },
}))
vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }))
vi.mock('../utils/motion', () => ({
  staggerContainer: { initial: {}, animate: {} },
  staggerItem: { initial: {}, animate: {} },
  staticVariants: { initial: {}, animate: {}, exit: {} },
  suggestionHover: { y: -3 },
}))

import EmptyState from '../components/EmptyState'

describe('EmptyState', () => {
  it('is a function component', () => {
    expect(typeof EmptyState).toBe('function')
  })

  it('renders without crashing', () => {
    const result = EmptyState({ onSuggestionClick: vi.fn() })
    expect(result).not.toBeNull()
  })

  it('contains greeting text', () => {
    const result = EmptyState({ onSuggestionClick: vi.fn() })
    const json = JSON.stringify(result)
    expect(json).toContain('Wie kann ich helfen')
  })

  it('renders suggestion buttons', () => {
    const result = EmptyState({ onSuggestionClick: vi.fn() })
    const json = JSON.stringify(result)
    expect(json).toContain('Kalender')
    expect(json).toContain('E-Mails')
  })

  it('uses motion variants instead of CSS animation', () => {
    const result = EmptyState({ onSuggestionClick: vi.fn() })
    const json = JSON.stringify(result)
    expect(json).toContain('variants')
    expect(json).not.toContain('animate-fade-in')
  })

  it('renders suggestion icons', () => {
    const result = EmptyState({ onSuggestionClick: vi.fn() })
    const json = JSON.stringify(result)
    expect(json).toContain('📅')
    expect(json).toContain('📩')
    expect(json).toContain('📝')
    expect(json).toContain('📂')
  })
})
