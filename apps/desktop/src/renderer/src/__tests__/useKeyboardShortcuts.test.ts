import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the effect callback
let effectCb: (() => (() => void) | void) | null = null

// Mock addEventListener/removeEventListener
const mockAddEventListener = vi.fn()
const mockRemoveEventListener = vi.fn()

vi.stubGlobal('window', {
  addEventListener: mockAddEventListener,
  removeEventListener: mockRemoveEventListener,
})

vi.mock('react', () => ({
  useEffect: (cb: () => (() => void) | void) => {
    effectCb = cb
  },
}))

import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import type { ShortcutConfig } from '../hooks/useKeyboardShortcuts'

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    effectCb = null
  })

  it('is a function', () => {
    expect(typeof useKeyboardShortcuts).toBe('function')
  })

  it('accepts an array of shortcut configs', () => {
    useKeyboardShortcuts([{ key: 'k', meta: true, handler: vi.fn() }])
    expect(effectCb).not.toBeNull()
  })

  it('registers keydown listener in effect', () => {
    useKeyboardShortcuts([{ key: 'Escape', handler: vi.fn() }])
    effectCb!()
    expect(mockAddEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('returns cleanup that removes listener', () => {
    useKeyboardShortcuts([{ key: 'Escape', handler: vi.fn() }])
    const cleanup = effectCb!()
    expect(typeof cleanup).toBe('function')
    if (typeof cleanup === 'function') cleanup()
    expect(mockRemoveEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('calls handler for matching key event', () => {
    const handler = vi.fn()
    useKeyboardShortcuts([{ key: 'Escape', handler }])
    effectCb!()

    const keydownHandler = mockAddEventListener.mock.calls[0]![1] as (e: Partial<KeyboardEvent>) => void
    keydownHandler({ key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false, preventDefault: vi.fn(), target: null } as unknown as KeyboardEvent)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('requires meta key when configured', () => {
    const handler = vi.fn()
    useKeyboardShortcuts([{ key: 'k', meta: true, handler }])
    effectCb!()

    const keydownHandler = mockAddEventListener.mock.calls[0]![1] as (e: Partial<KeyboardEvent>) => void
    const prevent = vi.fn()
    // Without meta — should not fire
    keydownHandler({ key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, preventDefault: prevent, target: null } as unknown as KeyboardEvent)
    expect(handler).not.toHaveBeenCalled()

    // With meta — should fire
    keydownHandler({ key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, preventDefault: prevent, target: null } as unknown as KeyboardEvent)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('supports shift modifier', () => {
    const handler = vi.fn()
    useKeyboardShortcuts([{ key: 'n', meta: true, shift: true, handler }])
    effectCb!()

    const keydownHandler = mockAddEventListener.mock.calls[0]![1] as (e: Partial<KeyboardEvent>) => void
    const prevent = vi.fn()
    // Meta but no shift
    keydownHandler({ key: 'n', metaKey: true, ctrlKey: false, shiftKey: false, preventDefault: prevent, target: null } as unknown as KeyboardEvent)
    expect(handler).not.toHaveBeenCalled()

    // Meta + shift
    keydownHandler({ key: 'n', metaKey: true, ctrlKey: false, shiftKey: true, preventDefault: prevent, target: null } as unknown as KeyboardEvent)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('exports ShortcutConfig type', () => {
    const config: ShortcutConfig = { key: 'a', handler: vi.fn() }
    expect(config.key).toBe('a')
  })
})
