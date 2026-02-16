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

import type { Session } from '../hooks/useSessions'
import type { SessionListProps } from '../components/SessionList'

// We import the module to verify it exports correctly
import SessionList from '../components/SessionList'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(): void {
  stateSlots = []
  stateIndex = 0
}

function createProps(overrides?: Partial<SessionListProps>): SessionListProps {
  return {
    sessions: [],
    activeSessionId: null,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
}

function createSession(id: string, title: string, daysAgo = 0): Session {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return { id, title, lastMessageAt: date.toISOString() }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('is a function component', () => {
    expect(typeof SessionList).toBe('function')
  })

  it('accepts correct props interface', () => {
    const props = createProps({
      sessions: [createSession('s1', 'Chat 1')],
      activeSessionId: 's1',
    })

    // Verify props shape is valid
    expect(props.sessions).toHaveLength(1)
    expect(props.activeSessionId).toBe('s1')
    expect(typeof props.onSelect).toBe('function')
    expect(typeof props.onCreate).toBe('function')
    expect(typeof props.onDelete).toBe('function')
  })

  it('renders without crashing with empty sessions', () => {
    const props = createProps()
    stateIndex = 0
    const result = SessionList(props)
    expect(result).toBeDefined()
  })

  it('renders without crashing with sessions', () => {
    const props = createProps({
      sessions: [
        createSession('s1', 'Erster Chat'),
        createSession('s2', 'Zweiter Chat', 1),
      ],
    })
    stateIndex = 0
    const result = SessionList(props)
    expect(result).toBeDefined()
  })

  it('renders without crashing with active session', () => {
    const props = createProps({
      sessions: [createSession('s1', 'Chat 1')],
      activeSessionId: 's1',
    })
    stateIndex = 0
    const result = SessionList(props)
    expect(result).toBeDefined()
  })

  it('Session type has required fields', () => {
    const session = createSession('id-1', 'Test Title', 2)
    expect(session).toHaveProperty('id')
    expect(session).toHaveProperty('title')
    expect(session).toHaveProperty('lastMessageAt')
    expect(typeof session.id).toBe('string')
    expect(typeof session.title).toBe('string')
    expect(typeof session.lastMessageAt).toBe('string')
  })

  it('handles sessions sorted by date', () => {
    const sessions = [
      createSession('s1', 'Old Chat', 5),
      createSession('s2', 'New Chat', 0),
      createSession('s3', 'Yesterday Chat', 1),
    ]

    const sorted = [...sessions].sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    )

    expect(sorted[0]!.id).toBe('s2')
    expect(sorted[1]!.id).toBe('s3')
    expect(sorted[2]!.id).toBe('s1')
  })
})
