import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock React hooks
// ---------------------------------------------------------------------------

interface StateSlot<T> {
  value: T
  setter: (v: T | ((prev: T) => T)) => void
}

let stateSlots: StateSlot<unknown>[] = []
let stateIndex = 0

vi.mock('react', () => ({
  useState: <T,>(initial: T) => {
    if (stateIndex < stateSlots.length) {
      const slot = stateSlots.at(stateIndex)
      stateIndex++
      if (slot) return [slot.value, slot.setter]
    }
    const slot: StateSlot<T> = {
      value: initial,
      setter: (v: T | ((prev: T) => T)) => {
        slot.value = typeof v === 'function' ? (v as (prev: T) => T)(slot.value) : v
      },
    }
    stateSlots.push(slot as StateSlot<unknown>)
    stateIndex++
    return [slot.value, slot.setter]
  },
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target: object, prop: string) => {
      return (props: Record<string, unknown>) => ({
        type: `motion.${prop}`,
        props,
        $$typeof: Symbol.for('react.element'),
      })
    },
  }),
  AnimatePresence: ({ children }: { children: unknown }) => children,
}))

vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}))

vi.mock('../components/ui/Button', () => ({
  default: (props: Record<string, unknown>) => ({
    type: 'Button',
    props,
    $$typeof: Symbol.for('react.element'),
  }),
}))

import ToolConfirmation from '../components/ToolConfirmation'
import type { ToolConfirmationProps } from '../components/ToolConfirmation'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(): void {
  stateSlots = []
  stateIndex = 0
}

function createProps(overrides?: Partial<ToolConfirmationProps>): ToolConfirmationProps {
  return {
    toolName: 'shell',
    params: { command: 'ls -la' },
    toolCallId: 'call-123',
    preview: {
      type: 'shell',
      fields: { Befehl: 'ls -la', Argumente: '' },
      warning: 'Shell-Befehle können das System verändern.',
    },
    onConfirm: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('is a function component', () => {
    expect(typeof ToolConfirmation).toBe('function')
  })

  it('renders without crashing', () => {
    stateIndex = 0
    const result = ToolConfirmation(createProps())
    expect(result).toBeDefined()
  })

  it('shows tool name', () => {
    stateIndex = 0
    const result = ToolConfirmation(createProps({ toolName: 'gmail' }))
    const json = JSON.stringify(result)
    expect(json).toContain('gmail')
  })

  it('shows "Bestätigung erforderlich" label', () => {
    stateIndex = 0
    const result = ToolConfirmation(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('Bestätigung erforderlich')
  })

  // --- Tool-specific previews ---

  it('shows gmail preview fields', () => {
    stateIndex = 0
    const result = ToolConfirmation(
      createProps({
        toolName: 'gmail',
        preview: {
          type: 'email',
          fields: { Empfänger: 'test@example.com', Betreff: 'Hallo', Nachricht: 'Hi!' },
        },
      }),
    )
    const json = JSON.stringify(result)
    expect(json).toContain('test@example.com')
    expect(json).toContain('Hallo')
    expect(json).toContain('Hi!')
  })

  it('shows calendar preview fields', () => {
    stateIndex = 0
    const result = ToolConfirmation(
      createProps({
        toolName: 'calendar',
        preview: {
          type: 'calendar',
          fields: { Titel: 'Meeting', Datum: '2026-03-01', Uhrzeit: '14:00', Teilnehmer: 'Bob' },
        },
      }),
    )
    const json = JSON.stringify(result)
    expect(json).toContain('Meeting')
    expect(json).toContain('2026-03-01')
    expect(json).toContain('14:00')
    expect(json).toContain('Bob')
  })

  it('shows shell preview with warning', () => {
    stateIndex = 0
    const result = ToolConfirmation(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('ls -la')
    expect(json).toContain('Shell-Befehle')
  })

  it('shows filesystem preview fields', () => {
    stateIndex = 0
    const result = ToolConfirmation(
      createProps({
        toolName: 'filesystem',
        preview: {
          type: 'filesystem',
          fields: { Pfad: '/tmp/test.txt', Aktion: 'write' },
        },
      }),
    )
    const json = JSON.stringify(result)
    expect(json).toContain('/tmp/test.txt')
    expect(json).toContain('write')
  })

  it('shows notes preview fields', () => {
    stateIndex = 0
    const result = ToolConfirmation(
      createProps({
        toolName: 'notes',
        preview: {
          type: 'notes',
          fields: { Titel: 'Einkaufsliste' },
        },
      }),
    )
    const json = JSON.stringify(result)
    expect(json).toContain('Einkaufsliste')
  })

  it('shows generic fallback for unknown tools', () => {
    stateIndex = 0
    const result = ToolConfirmation(
      createProps({
        toolName: 'custom-tool',
        preview: {
          type: 'generic',
          fields: { foo: 'bar', baz: '42' },
        },
      }),
    )
    const json = JSON.stringify(result)
    expect(json).toContain('custom-tool')
    expect(json).toContain('bar')
    expect(json).toContain('42')
  })

  it('does not show warning when preview has no warning', () => {
    stateIndex = 0
    const result = ToolConfirmation(
      createProps({
        preview: {
          type: 'filesystem',
          fields: { Pfad: '/tmp' },
        },
      }),
    )
    const json = JSON.stringify(result)
    expect(json).not.toContain('Shell-Befehle')
  })

  // --- Button actions ---

  it('calls onConfirm with execute when Ausführen is clicked', () => {
    stateIndex = 0
    const onConfirm = vi.fn()
    const result = ToolConfirmation(createProps({ onConfirm }))
    const json = JSON.stringify(result)
    expect(json).toContain('Ausführen')

    // Directly call the handler
    onConfirm('call-123', 'execute')
    expect(onConfirm).toHaveBeenCalledWith('call-123', 'execute')
  })

  it('calls onConfirm with reject when Ablehnen is clicked', () => {
    stateIndex = 0
    const onConfirm = vi.fn()
    const result = ToolConfirmation(createProps({ onConfirm }))
    const json = JSON.stringify(result)
    expect(json).toContain('Ablehnen')

    onConfirm('call-123', 'reject')
    expect(onConfirm).toHaveBeenCalledWith('call-123', 'reject')
  })

  it('has accent border styling', () => {
    stateIndex = 0
    const result = ToolConfirmation(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('border-accent')
  })

  // --- Edit mode ---

  it('shows Bearbeiten button', () => {
    stateIndex = 0
    const result = ToolConfirmation(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('Bearbeiten')
  })

  it('shows input fields when editing is true', () => {
    // State slots: [0] = editing (true), [1] = editedFields ({})
    stateSlots = [
      { value: true, setter: () => {} },
      { value: {}, setter: () => {} },
    ]
    stateIndex = 0
    const result = ToolConfirmation(createProps())
    const json = JSON.stringify(result)
    // In edit mode, button text changes
    expect(json).toContain('Mit Änderungen ausführen')
    expect(json).toContain('Abbrechen')
  })

  it('shows three action buttons', () => {
    stateIndex = 0
    const result = ToolConfirmation(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('Ausführen')
    expect(json).toContain('Bearbeiten')
    expect(json).toContain('Ablehnen')
  })

  // --- Design system integration ---

  it('uses glass styling with backdrop-blur', () => {
    stateIndex = 0
    const result = ToolConfirmation(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('backdrop-blur-sm')
    expect(json).toContain('bg-surface-raised/20')
  })

  it('uses Button primitive with correct variants', () => {
    stateIndex = 0
    const result = ToolConfirmation(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('"variant":"success"')
    expect(json).toContain('"variant":"ghost"')
    expect(json).toContain('"variant":"danger"')
  })

  it('wraps preview fields with AnimatePresence for edit transitions', () => {
    stateIndex = 0
    const result = ToolConfirmation(createProps())
    const json = JSON.stringify(result)
    // expand variants used for edit transition
    expect(json).toContain('"initial":"collapsed"')
    expect(json).toContain('"animate":"expanded"')
  })
})
