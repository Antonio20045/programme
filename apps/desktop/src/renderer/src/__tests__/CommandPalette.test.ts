import { describe, it, expect, vi, beforeEach } from 'vitest'

interface StateSlot<T> {
  value: T
  setter: (v: T | ((prev: T) => T)) => void
}

const stateSlots: StateSlot<unknown>[] = []
let stateIndex = 0

vi.mock('framer-motion', () => ({
  AnimatePresence: 'AnimatePresence',
  motion: { div: 'div', input: 'input' },
}))

vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}))

vi.mock('../utils/cn', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

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
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
  useEffect: vi.fn(),
  useRef: (initial: unknown) => ({ current: initial }),
}))

import CommandPalette from '../components/CommandPalette'
import type { CommandItem, CommandPaletteProps } from '../components/CommandPalette'

function createCommands(): CommandItem[] {
  return [
    { id: 'new-chat', label: 'Neuer Chat', category: 'Navigation', icon: '\u{2795}', action: vi.fn() },
    { id: 'settings', label: 'Einstellungen', category: 'Navigation', icon: '\u{2699}\uFE0F', action: vi.fn() },
    { id: 'model', label: 'Modell wechseln', category: 'Konfiguration', icon: '\u{1F916}', shortcut: '\u2318M', action: vi.fn() },
  ]
}

function createProps(overrides?: Partial<CommandPaletteProps>): CommandPaletteProps {
  return {
    open: true,
    onClose: vi.fn(),
    commands: createCommands(),
    ...overrides,
  }
}

function resetState(): void {
  stateSlots.length = 0
  stateIndex = 0
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('is a function component', () => {
    expect(typeof CommandPalette).toBe('function')
  })

  it('renders no content when not open', () => {
    const result = CommandPalette(createProps({ open: false }))
    const json = JSON.stringify(result)
    expect(json).not.toContain('Befehl suchen...')
    expect(json).not.toContain('Neuer Chat')
  })

  it('renders when open', () => {
    const result = CommandPalette(createProps())
    expect(result).not.toBeNull()
  })

  it('shows search placeholder', () => {
    const result = CommandPalette(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('Befehl suchen...')
  })

  it('shows ESC hint', () => {
    const result = CommandPalette(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('ESC')
  })

  it('renders command labels', () => {
    const result = CommandPalette(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('Neuer Chat')
    expect(json).toContain('Einstellungen')
    expect(json).toContain('Modell wechseln')
  })

  it('renders category headers', () => {
    const result = CommandPalette(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('Navigation')
    expect(json).toContain('Konfiguration')
  })

  it('renders keyboard shortcuts', () => {
    const result = CommandPalette(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('\u2318M')
  })

  it('renders command icons', () => {
    const result = CommandPalette(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('\u{2795}')
    expect(json).toContain('\u{1F916}')
  })

  it('has backdrop overlay', () => {
    const result = CommandPalette(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('bg-black/50')
  })

  it('uses glass styling on panel', () => {
    const result = CommandPalette(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('glass')
  })

  it('shows empty state when no commands match', () => {
    const result = CommandPalette(createProps({ commands: [] }))
    const json = JSON.stringify(result)
    expect(json).toContain('Kein Befehl gefunden')
  })

  it('selected item has layoutId highlight', () => {
    const result = CommandPalette(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('palette-highlight')
  })

  it('content elements have relative z-10 for layering above highlight', () => {
    const result = CommandPalette(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('relative z-10')
  })

  it('exports CommandItem type', () => {
    const item: CommandItem = { id: 'test', label: 'Test', category: 'Cat', action: vi.fn() }
    expect(item.id).toBe('test')
  })
})
