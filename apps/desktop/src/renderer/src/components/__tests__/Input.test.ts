import { describe, it, expect, vi } from 'vitest'

let idCounter = 0

vi.mock('framer-motion', () => ({
  motion: {
    input: (props: Record<string, unknown>) => ({ type: 'input', props }),
  },
}))

vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useId: () => `:r${idCounter++}:`,
  }
})

import Input from '../ui/Input'

describe('Input', () => {
  it('is a function component', () => {
    expect(typeof Input).toBe('function')
  })

  it('renders a basic input', () => {
    const result = Input({})
    const json = JSON.stringify(result)
    expect(json).toContain('bg-surface-alt')
    expect(json).toContain('border-edge')
  })

  it('renders label when provided', () => {
    const result = Input({ label: 'Name' })
    const json = JSON.stringify(result)
    expect(json).toContain('Name')
    expect(json).toContain('htmlFor')
  })

  it('renders error message', () => {
    const result = Input({ error: 'Pflichtfeld' })
    const json = JSON.stringify(result)
    expect(json).toContain('Pflichtfeld')
    expect(json).toContain('text-error')
    expect(json).toContain('border-error')
  })

  it('uses default border when no error', () => {
    const result = Input({})
    const json = JSON.stringify(result)
    expect(json).toContain('border-edge')
    expect(json).not.toContain('border-error')
  })

  it('has whileFocus animation', () => {
    const result = Input({})
    const json = JSON.stringify(result)
    expect(json).toContain('whileFocus')
    expect(json).toContain('shadow-accent')
  })

  it('merges custom className', () => {
    const result = Input({ className: 'mt-2' })
    const json = JSON.stringify(result)
    expect(json).toContain('mt-2')
  })
})
