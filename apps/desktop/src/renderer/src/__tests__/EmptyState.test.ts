import { describe, it, expect, vi } from 'vitest'
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

  it('has fade-in animation', () => {
    const result = EmptyState({ onSuggestionClick: vi.fn() })
    const json = JSON.stringify(result)
    expect(json).toContain('animate-fade-in')
  })
})
