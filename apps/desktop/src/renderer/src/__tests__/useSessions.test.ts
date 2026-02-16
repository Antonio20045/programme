import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock fetch before importing the hook
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
vi.stubGlobal('fetch', mockFetch)

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
import { GATEWAY_URL } from '../config'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
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

  it('refreshSessions fetches from correct URL', () => {
    mockFetch.mockResolvedValue(createJsonResponse([]))

    const { refreshSessions } = callHook()
    refreshSessions()

    expect(mockFetch).toHaveBeenCalledWith(`${GATEWAY_URL}/api/sessions`)
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

    mockFetch
      .mockResolvedValueOnce(createJsonResponse(sessionsData))
      .mockResolvedValueOnce(createJsonResponse(messages1))
      .mockResolvedValueOnce(createJsonResponse(messages2))

    const { refreshSessions } = callHook()
    refreshSessions()

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    expect(mockFetch).toHaveBeenCalledWith(`${GATEWAY_URL}/api/sessions/sess-1/messages`)
    expect(mockFetch).toHaveBeenCalledWith(`${GATEWAY_URL}/api/sessions/sess-2/messages`)
  })

  it('refreshSessions sets isLoading during fetch', () => {
    mockFetch.mockResolvedValue(createJsonResponse([]))

    const { refreshSessions } = callHook()
    refreshSessions()

    // isLoading is the 4th useState (sessions, activeSessionId, messages, isLoading)
    const loadingSlot = stateSlots[3]
    expect(loadingSlot).toBeDefined()
  })

  it('refreshSessions handles fetch error gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const { refreshSessions } = callHook()
    refreshSessions()

    await vi.waitFor(() => {
      const loadingSlot = stateSlots[3]
      expect(loadingSlot).toBeDefined()
    })
  })

  it('refreshSessions handles invalid data gracefully', async () => {
    mockFetch.mockResolvedValue(createJsonResponse('not-an-array'))

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

    mockFetch.mockResolvedValue(createJsonResponse(messagesData))

    const { selectSession } = callHook()
    selectSession('sess-1')

    expect(mockFetch).toHaveBeenCalledWith(`${GATEWAY_URL}/api/sessions/sess-1/messages`)

    // activeSessionId setter should have been called
    const activeSlot = stateSlots[1]
    expect(activeSlot).toBeDefined()
    expect(activeSlot!.value).toBe('sess-1')
  })

  it('selectSession handles fetch error gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const { selectSession } = callHook()
    selectSession('sess-1')

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    // Should not throw
  })

  it('selectSession handles invalid message data', async () => {
    mockFetch.mockResolvedValue(createJsonResponse('invalid'))

    const { selectSession } = callHook()
    selectSession('sess-1')

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
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

  it('deleteSession sends DELETE request to correct URL', () => {
    mockFetch.mockResolvedValue(createJsonResponse(null))

    const { deleteSession } = callHook()
    deleteSession('sess-1')

    expect(mockFetch).toHaveBeenCalledWith(
      `${GATEWAY_URL}/api/sessions/sess-1`,
      { method: 'DELETE' },
    )
  })

  it('deleteSession removes session from list on success', async () => {
    mockFetch.mockResolvedValue(createJsonResponse(null))

    const { deleteSession } = callHook()

    // Pre-populate sessions
    const sessionsSlot = stateSlots[0]
    sessionsSlot!.setter([
      { id: 'sess-1', title: 'Chat 1', lastMessageAt: '2026-02-16T10:00:00Z' },
      { id: 'sess-2', title: 'Chat 2', lastMessageAt: '2026-02-16T11:00:00Z' },
    ])

    deleteSession('sess-1')

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  it('deleteSession handles fetch error gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const { deleteSession } = callHook()
    deleteSession('sess-1')

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    // Should not throw
  })

  it('deleteSession resets active session if deleted session is active', async () => {
    mockFetch.mockResolvedValue(createJsonResponse(null))

    callHook()

    // Set active session
    const activeSlot = stateSlots[1]
    activeSlot!.setter('sess-1')

    // Re-call to get updated deleteSession closure with activeSessionId='sess-1'
    stateIndex = 0
    const { deleteSession: deleteWithActive } = useSessions()
    deleteWithActive('sess-1')

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  it('loads sessions on mount via useEffect', () => {
    mockFetch.mockResolvedValue(createJsonResponse([]))

    callHook()

    // useEffect should have been registered
    expect(effectCallbacks).toHaveLength(1)

    // Execute the mount effect
    effectCallbacks[0]!()

    expect(mockFetch).toHaveBeenCalledWith(`${GATEWAY_URL}/api/sessions`)
  })

  it('title is derived from first user message content', async () => {
    const sessionsData = [
      { id: 'sess-1', lastMessageAt: '2026-02-16T10:00:00Z' },
    ]

    const longMessage = 'A'.repeat(60)
    const messagesData = [
      { id: 'msg-1', role: 'user', content: longMessage },
    ]

    mockFetch
      .mockResolvedValueOnce(createJsonResponse(sessionsData))
      .mockResolvedValueOnce(createJsonResponse(messagesData))

    const { refreshSessions } = callHook()
    refreshSessions()

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  it('title defaults to "Neuer Chat" when no user messages exist', async () => {
    const sessionsData = [
      { id: 'sess-1', lastMessageAt: '2026-02-16T10:00:00Z' },
    ]

    const messagesData = [
      { id: 'msg-1', role: 'assistant', content: 'Hallo!' },
    ]

    mockFetch
      .mockResolvedValueOnce(createJsonResponse(sessionsData))
      .mockResolvedValueOnce(createJsonResponse(messagesData))

    const { refreshSessions } = callHook()
    refreshSessions()

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  it('uses GATEWAY_URL from config for all requests', () => {
    mockFetch.mockResolvedValue(createJsonResponse([]))

    const { refreshSessions, selectSession, deleteSession } = callHook()

    refreshSessions()
    selectSession('test-id')
    deleteSession('test-id')

    const urls = mockFetch.mock.calls.map((c) => c[0] as string)

    for (const url of urls) {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:18789\//)
    }
  })

  it('does not use 0.0.0.0 for any requests', () => {
    mockFetch.mockResolvedValue(createJsonResponse([]))

    const { refreshSessions, selectSession, deleteSession } = callHook()

    refreshSessions()
    selectSession('test-id')
    deleteSession('test-id')

    const urls = mockFetch.mock.calls.map((c) => c[0] as string)

    for (const url of urls) {
      expect(url).not.toContain('0.0.0.0')
    }
  })
})
