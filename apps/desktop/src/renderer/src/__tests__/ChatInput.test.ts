import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock React hooks
// ---------------------------------------------------------------------------
interface StateSlot<T> {
  value: T
  setter: (v: T | ((prev: T) => T)) => void
}

const stateSlots: StateSlot<unknown>[] = []
let stateIndex = 0

vi.mock('react', () => ({
  useState: <T,>(initial: T) => {
    if (stateIndex >= stateSlots.length) {
      const slot: StateSlot<T> = {
        value: initial,
        setter: vi.fn((v: T | ((prev: T) => T)) => {
          slot.value = typeof v === 'function' ? (v as (prev: T) => T)(slot.value) : v
        }),
      }
      stateSlots.push(slot as StateSlot<unknown>)
    }
    const slot = stateSlots[stateIndex]!
    stateIndex++
    return [slot.value, slot.setter]
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

// Mock child components
vi.mock('../components/AttachmentButton', () => ({
  default: () => ({ type: 'mock-attachment-button' }),
}))

vi.mock('../components/FilePreview', () => ({
  default: () => null,
}))

import ChatInput from '../components/ChatInput'

describe('ChatInput', () => {
  beforeEach(() => {
    stateSlots.length = 0
    stateIndex = 0
  })

  it('is a function component', () => {
    expect(typeof ChatInput).toBe('function')
  })

  it('renders without crashing', () => {
    stateIndex = 0
    const result = ChatInput({ onSend: vi.fn(), disabled: false })
    expect(result).not.toBeNull()
  })

  it('contains send button', () => {
    stateIndex = 0
    const result = ChatInput({ onSend: vi.fn(), disabled: false })
    const json = JSON.stringify(result)
    expect(json).toContain('Senden')
  })

  it('shows keyboard shortcut hint', () => {
    stateIndex = 0
    const result = ChatInput({ onSend: vi.fn(), disabled: false })
    const json = JSON.stringify(result)
    expect(json).toContain('Enter zum Senden')
    expect(json).toContain('Shift+Enter')
  })

  it('uses accent color for send button', () => {
    stateIndex = 0
    const result = ChatInput({ onSend: vi.fn(), disabled: false })
    const json = JSON.stringify(result)
    expect(json).toContain('bg-accent')
  })

  it('accepts custom placeholder', () => {
    stateIndex = 0
    const result = ChatInput({ onSend: vi.fn(), disabled: false, placeholder: 'Test...' })
    const json = JSON.stringify(result)
    expect(json).toContain('Test...')
  })
})
