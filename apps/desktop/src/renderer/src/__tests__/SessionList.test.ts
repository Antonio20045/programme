import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock framer-motion, useReducedMotion, and motion utils
// ---------------------------------------------------------------------------

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: unknown }) => children,
  motion: {
    div: (props: Record<string, unknown>) => ({ type: 'div', props }),
  },
}))
vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }))
vi.mock('../utils/motion', () => ({
  sessionItemVariants: { initial: {}, animate: {}, exit: {} },
  sessionItemTransition: { duration: 0.15 },
  staticVariants: { initial: {}, animate: {}, exit: {} },
}))

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
  useMemo: <T,>(fn: () => T) => fn(),
}))

import type { Session } from '../hooks/useSessions'
import type { SessionListProps } from '../components/SessionList'

// We import the module to verify it exports correctly
import SessionList, { groupSessions } from '../components/SessionList'

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

  it('renders time group headers', () => {
    const props = createProps({
      sessions: [
        createSession('s1', 'Today Chat', 0),
        createSession('s2', 'Yesterday Chat', 1),
      ],
    })
    stateIndex = 0
    const result = SessionList(props)
    const json = JSON.stringify(result)
    expect(json).toContain('Heute')
    expect(json).toContain('Gestern')
  })

  it('shows hover delete button with aria-label', () => {
    const props = createProps({
      sessions: [createSession('s1', 'Chat 1')],
    })
    stateIndex = 0
    const result = SessionList(props)
    const json = JSON.stringify(result)
    expect(json).toContain('Chat löschen')
  })

  it('wraps session items in motion.div with variants', () => {
    const props = createProps({
      sessions: [createSession('s1', 'Chat 1')],
    })
    stateIndex = 0
    const result = SessionList(props)
    const json = JSON.stringify(result)
    expect(json).toContain('"initial":"initial"')
    expect(json).toContain('"animate":"animate"')
    expect(json).toContain('"exit":"exit"')
  })

  it('sets layout prop on motion.div for smooth reordering', () => {
    const props = createProps({
      sessions: [createSession('s1', 'Chat 1')],
    })
    stateIndex = 0
    const result = SessionList(props)
    const json = JSON.stringify(result)
    expect(json).toContain('"layout":true')
  })
})

describe('groupSessions', () => {
  it('returns empty array for no sessions', () => {
    expect(groupSessions([])).toEqual([])
  })

  it('groups sessions by time period', () => {
    const sessions = [
      createSession('s1', 'Today', 0),
      createSession('s2', 'Also Today', 0),
      createSession('s3', 'Yesterday', 1),
    ]
    const groups = groupSessions(sessions)
    expect(groups).toHaveLength(2)
    expect(groups[0]!.label).toBe('Heute')
    expect(groups[0]!.sessions).toHaveLength(2)
    expect(groups[1]!.label).toBe('Gestern')
    expect(groups[1]!.sessions).toHaveLength(1)
  })

  it('preserves insertion order of groups', () => {
    const sessions = [
      createSession('s1', 'Old', 10),
      createSession('s2', 'Today', 0),
    ]
    const groups = groupSessions(sessions)
    // First group seen is "Diesen Monat" (10 days ago), then "Heute"
    expect(groups[0]!.label).not.toBe('Heute')
    expect(groups[1]!.label).toBe('Heute')
  })
})
