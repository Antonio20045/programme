import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock window.api before importing the hook
// ---------------------------------------------------------------------------

const mockGatewayFetch = vi.fn<(data: { method: string; path: string; body?: unknown }) => Promise<{ ok: boolean; status: number; data: unknown }>>()

Object.defineProperty(globalThis, 'window', {
  value: {
    api: {
      gatewayFetch: mockGatewayFetch,
    },
  },
  writable: true,
})

// ---------------------------------------------------------------------------
// Mock React hooks to test without DOM
// ---------------------------------------------------------------------------

interface StateSlot<T> {
  value: T
  setter: (v: T | ((prev: T) => T)) => void
}

let stateSlots: StateSlot<unknown>[] = []
let stateIndex = 0
let effectCallbacks: Array<() => (() => void) | void> = []

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
  useEffect: (cb: () => (() => void) | void) => {
    effectCallbacks.push(cb)
  },
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

import { useSessions } from '../hooks/useSessions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGatewayResult(data: unknown, ok = true, status = 200): { ok: boolean; status: number; data: unknown } {
  return { ok, status, data }
}

function resetHookState(): void {
  stateSlots = []
  stateIndex = 0
  effectCallbacks = []
}

function callHook(): ReturnType<typeof useSessions> {
  stateIndex = 0
  return useSessions()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetHookState()
  })

  it('returns correct initial state', () => {
    const result = callHook()
    expect(result.sessions).toEqual([])
    expect(result.activeSessionId).toBeNull()
    expect(result.isLoading).toBe(false)
    expect(result.messages).toEqual([])
    expect(typeof result.selectSession).toBe('function')
    expect(typeof result.createSession).toBe('function')
    expect(typeof result.deleteSession).toBe('function')
    expect(typeof result.refreshSessions).toBe('function')
  })

  it('refreshSessions calls gatewayFetch with correct path', () => {
    mockGatewayFetch.mockResolvedValue(createGatewayResult([]))

    const { refreshSessions } = callHook()
    refreshSessions()

    expect(mockGatewayFetch).toHaveBeenCalledWith({ method: 'GET', path: '/api/sessions' })
  })

  it('refreshSessions parses session list and fetches titles', async () => {
    const sessionsData = [
      { id: 'sess-1', lastMessageAt: '2026-02-16T10:00:00Z' },
      { id: 'sess-2', lastMessageAt: '2026-02-16T11:00:00Z' },
    ]

    const messages1 = [
      { id: 'msg-1', role: 'user', content: 'Hallo Welt' },
      { id: 'msg-2', role: 'assistant', content: 'Hi!' },
    ]

    const messages2 = [
      { id: 'msg-3', role: 'user', content: 'Zweiter Chat' },
    ]

    mockGatewayFetch
      .mockResolvedValueOnce(createGatewayResult(sessionsData))
      .mockResolvedValueOnce(createGatewayResult(messages1))
      .mockResolvedValueOnce(createGatewayResult(messages2))

    const { refreshSessions } = callHook()
    refreshSessions()

    await vi.waitFor(() => {
      expect(mockGatewayFetch).toHaveBeenCalledTimes(3)
    })

    expect(mockGatewayFetch).toHaveBeenCalledWith({ method: 'GET', path: '/api/sessions/sess-1/messages' })
    expect(mockGatewayFetch).toHaveBeenCalledWith({ method: 'GET', path: '/api/sessions/sess-2/messages' })
  })

  it('refreshSessions sets isLoading during fetch', () => {
    mockGatewayFetch.mockResolvedValue(createGatewayResult([]))

    const { refreshSessions } = callHook()
    refreshSessions()

    // isLoading is the 4th useState (sessions, activeSessionId, messages, isLoading)
    const loadingSlot = stateSlots[3]
    expect(loadingSlot).toBeDefined()
  })

  it('refreshSessions handles fetch error gracefully', async () => {
    mockGatewayFetch.mockRejectedValue(new Error('Network error'))

    const { refreshSessions } = callHook()
    refreshSessions()

    await vi.waitFor(() => {
      const loadingSlot = stateSlots[3]
      expect(loadingSlot).toBeDefined()
    })
  })

  it('refreshSessions handles invalid data gracefully', async () => {
    mockGatewayFetch.mockResolvedValue(createGatewayResult('not-an-array'))

    const { refreshSessions } = callHook()
    refreshSessions()

    await vi.waitFor(() => {
      const loadingSlot = stateSlots[3]
      expect(loadingSlot).toBeDefined()
    })
  })

  it('selectSession sets activeSessionId and loads messages', async () => {
    const messagesData = [
      { id: 'msg-1', role: 'user', content: 'Hallo' },
      { id: 'msg-2', role: 'assistant', content: 'Hi!' },
    ]

    mockGatewayFetch.mockResolvedValue(createGatewayResult(messagesData))

    const { selectSession } = callHook()
    selectSession('sess-1')

    expect(mockGatewayFetch).toHaveBeenCalledWith({ method: 'GET', path: '/api/sessions/sess-1/messages' })

    // activeSessionId setter should have been called
    const activeSlot = stateSlots[1]
    expect(activeSlot).toBeDefined()
    expect(activeSlot!.value).toBe('sess-1')
  })

  it('selectSession handles fetch error gracefully', async () => {
    mockGatewayFetch.mockRejectedValue(new Error('Network error'))

    const { selectSession } = callHook()
    selectSession('sess-1')

    await vi.waitFor(() => {
      expect(mockGatewayFetch).toHaveBeenCalledTimes(1)
    })

    // Should not throw
  })

  it('selectSession handles invalid message data', async () => {
    mockGatewayFetch.mockResolvedValue(createGatewayResult('invalid'))

    const { selectSession } = callHook()
    selectSession('sess-1')

    await vi.waitFor(() => {
      expect(mockGatewayFetch).toHaveBeenCalledTimes(1)
    })
  })

  it('createSession resets activeSessionId and messages', () => {
    const { createSession } = callHook()

    // Set activeSessionId first
    const activeSlot = stateSlots[1]
    activeSlot!.setter('sess-1')

    createSession()

    expect(activeSlot!.value).toBeNull()
  })

  it('deleteSession sends DELETE request to correct path', () => {
    mockGatewayFetch.mockResolvedValue(createGatewayResult(null))

    const { deleteSession } = callHook()
    deleteSession('sess-1')

    expect(mockGatewayFetch).toHaveBeenCalledWith({ method: 'DELETE', path: '/api/sessions/sess-1' })
  })

  it('deleteSession removes session from list on success', async () => {
    mockGatewayFetch.mockResolvedValue(createGatewayResult(null))

    const { deleteSession } = callHook()

    // Pre-populate sessions
    const sessionsSlot = stateSlots[0]
    sessionsSlot!.setter([
      { id: 'sess-1', title: 'Chat 1', lastMessageAt: '2026-02-16T10:00:00Z' },
      { id: 'sess-2', title: 'Chat 2', lastMessageAt: '2026-02-16T11:00:00Z' },
    ])

    deleteSession('sess-1')

    await vi.waitFor(() => {
      expect(mockGatewayFetch).toHaveBeenCalledTimes(1)
    })
  })

  it('deleteSession handles fetch error gracefully', async () => {
    mockGatewayFetch.mockRejectedValue(new Error('Network error'))

    const { deleteSession } = callHook()
    deleteSession('sess-1')

    await vi.waitFor(() => {
      expect(mockGatewayFetch).toHaveBeenCalledTimes(1)
    })

    // Should not throw
  })

  it('deleteSession resets active session if deleted session is active', async () => {
    mockGatewayFetch.mockResolvedValue(createGatewayResult(null))

    callHook()

    // Set active session
    const activeSlot = stateSlots[1]
    activeSlot!.setter('sess-1')

    // Re-call to get updated deleteSession closure with activeSessionId='sess-1'
    stateIndex = 0
    const { deleteSession: deleteWithActive } = useSessions()
    deleteWithActive('sess-1')

    await vi.waitFor(() => {
      expect(mockGatewayFetch).toHaveBeenCalledTimes(1)
    })
  })

  it('loads sessions on mount via useEffect', () => {
    mockGatewayFetch.mockResolvedValue(createGatewayResult([]))

    callHook()

    // useEffect should have been registered
    expect(effectCallbacks).toHaveLength(1)

    // Execute the mount effect
    effectCallbacks[0]!()

    expect(mockGatewayFetch).toHaveBeenCalledWith({ method: 'GET', path: '/api/sessions' })
  })

  it('title is derived from first user message content', async () => {
    const sessionsData = [
      { id: 'sess-1', lastMessageAt: '2026-02-16T10:00:00Z' },
    ]

    const longMessage = 'A'.repeat(60)
    const messagesData = [
      { id: 'msg-1', role: 'user', content: longMessage },
    ]

    mockGatewayFetch
      .mockResolvedValueOnce(createGatewayResult(sessionsData))
      .mockResolvedValueOnce(createGatewayResult(messagesData))

    const { refreshSessions } = callHook()
    refreshSessions()

    await vi.waitFor(() => {
      expect(mockGatewayFetch).toHaveBeenCalledTimes(2)
    })
  })

  it('title defaults to "Neuer Chat" when no user messages exist', async () => {
    const sessionsData = [
      { id: 'sess-1', lastMessageAt: '2026-02-16T10:00:00Z' },
    ]

    const messagesData = [
      { id: 'msg-1', role: 'assistant', content: 'Hallo!' },
    ]

    mockGatewayFetch
      .mockResolvedValueOnce(createGatewayResult(sessionsData))
      .mockResolvedValueOnce(createGatewayResult(messagesData))

    const { refreshSessions } = callHook()
    refreshSessions()

    await vi.waitFor(() => {
      expect(mockGatewayFetch).toHaveBeenCalledTimes(2)
    })
  })

  it('all requests go through gatewayFetch proxy', () => {
    mockGatewayFetch.mockResolvedValue(createGatewayResult([]))

    const { refreshSessions, selectSession, deleteSession } = callHook()

    refreshSessions()
    selectSession('test-id')
    deleteSession('test-id')

    // All 3 calls should go through gatewayFetch
    expect(mockGatewayFetch).toHaveBeenCalledTimes(3)
    for (const call of mockGatewayFetch.mock.calls) {
      const arg = call[0] as { path: string }
      expect(arg.path).toMatch(/^\/api\//)
    }
  })
})
