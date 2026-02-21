import { describe, it, expect, vi, beforeEach } from 'vitest'

let effectCb: (() => (() => void) | void) | null = null

vi.mock('react', () => ({
  useEffect: (cb: () => (() => void) | void) => {
    effectCb = cb
  },
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

import SlideOverPanel from '../components/SlideOverPanel'
import type { SlideOverPanelProps } from '../components/SlideOverPanel'

function createProps(overrides?: Partial<SlideOverPanelProps>): SlideOverPanelProps {
  return {
    open: true,
    onClose: vi.fn(),
    title: 'Test Panel',
    children: 'Panel content',
    ...overrides,
  }
}

describe('SlideOverPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    effectCb = null
  })

  it('is a function component', () => {
    expect(typeof SlideOverPanel).toBe('function')
  })

  it('returns null when not open', () => {
    const result = SlideOverPanel(createProps({ open: false }))
    expect(result).toBeNull()
  })

  it('renders when open', () => {
    const result = SlideOverPanel(createProps())
    expect(result).not.toBeNull()
  })

  it('shows title', () => {
    const result = SlideOverPanel(createProps({ title: 'Einstellungen' }))
    const json = JSON.stringify(result)
    expect(json).toContain('Einstellungen')
  })

  it('has close button with aria-label', () => {
    const result = SlideOverPanel(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('Schließen')
  })

  it('has backdrop overlay', () => {
    const result = SlideOverPanel(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('bg-black/40')
  })

  it('uses slide-in animation', () => {
    const result = SlideOverPanel(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('animate-slide-in')
  })

  it('renders children content', () => {
    const result = SlideOverPanel(createProps({ children: 'Hello World' }))
    const json = JSON.stringify(result)
    expect(json).toContain('Hello World')
  })

  it('registers escape key listener when open', () => {
    SlideOverPanel(createProps({ open: true }))
    expect(effectCb).not.toBeNull()
  })
})
