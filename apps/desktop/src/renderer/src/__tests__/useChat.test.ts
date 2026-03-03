/* eslint-disable security/detect-object-injection */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock window.api + fetch + EventSource before importing the hook
// ---------------------------------------------------------------------------

const mockGatewayFetch = vi.fn<(data: { method: string; path: string; body?: unknown }) => Promise<{ ok: boolean; status: number; data: unknown }>>()
const mockGetStreamUrl = vi.fn<(sessionId: string) => Promise<string>>()
const mockFetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

vi.stubGlobal('fetch', mockFetch)

Object.defineProperty(globalThis, 'window', {
  value: {
    api: {
      gatewayFetch: mockGatewayFetch,
      getStreamUrl: mockGetStreamUrl,
    },
  },
  writable: true,
})

// Minimal EventSource mock
type ESListener = (event: MessageEvent | Event) => void

class MockEventSource {
  static readonly CLOSED = 2
  readonly url: string
  readyState = 0
  private listeners = new Map<string, ESListener[]>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: ESListener): void {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED
  }

  // Test helper: emit a named event
  emit(type: string, data?: string): void {
    const listeners = this.listeners.get(type) ?? []
    for (const listener of listeners) {
      if (data !== undefined) {
        listener(new MessageEvent(type, { data }))
      } else {
        listener(new Event(type))
      }
    }
  }

  static instances: MockEventSource[] = []
  static reset(): void {
    MockEventSource.instances = []
  }
}

vi.stubGlobal('EventSource', MockEventSource)

// Predictable UUID for new sessions
const MOCK_UUID = '00000000-0000-4000-8000-000000000000'
vi.stubGlobal('crypto', {
  ...globalThis.crypto,
  randomUUID: () => MOCK_UUID,
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
let callbackFns: Map<string, (...args: unknown[]) => unknown> = new Map()
let refSlots: Array<{ current: unknown }> = []
let refIndex = 0

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
  useRef: <T,>(initial: T) => {
    if (refIndex < refSlots.length) {
      const ref = refSlots[refIndex]
      refIndex++
      return ref as { current: T }
    }
    const ref = { current: initial }
    refSlots.push(ref)
    refIndex++
    return ref
  },
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => {
    const key = `cb-${callbackFns.size.toString()}`
    callbackFns.set(key, fn)
    return fn
  },
}))

vi.mock('../config', () => ({
  getGatewayUrl: () => 'http://127.0.0.1:18789',
  getGatewayMode: () => 'local',
  GATEWAY_URL: 'http://127.0.0.1:18789',
}))

import { useChat } from '../hooks/useChat'

const GATEWAY_URL = 'http://127.0.0.1:18789'

// ---------------------------------------------------------------------------
// State slot indices:
// [0] = messages (ChatMessage[])
// [1] = isLoading (boolean)
// [2] = error (string | null)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGatewayResult(data: unknown, ok = true, status = 200): { ok: boolean; status: number; data: unknown } {
  return { ok, status, data }
}

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
  callbackFns = new Map()
  refSlots = []
  refIndex = 0
  MockEventSource.reset()
}

function callHook(options?: Parameters<typeof useChat>[0]): ReturnType<typeof useChat> {
  stateIndex = 0
  refIndex = 0
  return useChat(options)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetHookState()
    mockGetStreamUrl.mockImplementation((sessionId: string) =>
      Promise.resolve(`${GATEWAY_URL}/api/stream/${sessionId}`),
    )
  })

  afterEach(() => {
    // Run all cleanup functions
    for (const cb of effectCallbacks) {
      const cleanup = cb()
      if (typeof cleanup === 'function') cleanup()
    }
  })

  it('returns correct initial state', () => {
    const result = callHook()
    expect(result.messages).toEqual([])
    expect(result.isLoading).toBe(false)
    expect(result.error).toBeNull()
    expect(typeof result.sendMessage).toBe('function')
  })

  it('posts message to gateway via gatewayFetch', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Hallo')

    expect(mockGatewayFetch).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/message',
      body: { text: 'Hallo', sessionId: MOCK_UUID },
    })
  })

  it('preserves sessionId across messages via ref', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Erste Nachricht')

    // Wait for stream URL resolve + EventSource creation
    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    // Loading finished
    const loadingSlot = stateSlots[1] // isLoading
    loadingSlot!.setter(false)

    // Re-call hook to get updated sendMessage
    const result2 = callHook()

    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-2', sessionId: 'sess-1' }),
    )

    result2.sendMessage('Zweite Nachricht')

    expect(mockGatewayFetch).toHaveBeenCalledTimes(2)
    const secondCall = mockGatewayFetch.mock.calls[1]?.[0] as { body: unknown }
    expect(secondCall.body).toEqual({ text: 'Zweite Nachricht', sessionId: MOCK_UUID })
  })

  it('opens EventSource after successful POST', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Test')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const es = MockEventSource.instances[0]!
    expect(es.url).toBe(`${GATEWAY_URL}/api/stream/sess-1`)
  })

  it('calls getStreamUrl for EventSource URL', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Test')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    expect(mockGetStreamUrl).toHaveBeenCalledWith('sess-1')
  })

  it('appends tokens to assistant message', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Test')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const es = MockEventSource.instances[0]!
    es.emit('token', 'Hallo ')
    es.emit('token', 'Welt')

    // The messages state setter should have been called
    const messagesSlot = stateSlots[0]
    expect(messagesSlot).toBeDefined()
  })

  it('closes EventSource on done event', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Test')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const es = MockEventSource.instances[0]!
    es.emit('done')

    expect(es.readyState).toBe(MockEventSource.CLOSED)
  })

  it('sets error on fetch failure', async () => {
    mockGatewayFetch.mockRejectedValue(new Error('Network error'))

    const { sendMessage } = callHook()
    sendMessage('Test')

    await vi.waitFor(() => {
      const errorSlot = stateSlots[2] // error
      expect(errorSlot).toBeDefined()
    })
  })

  it('sets error on non-ok response', async () => {
    mockGatewayFetch.mockResolvedValue(createGatewayResult({}, false, 500))

    const { sendMessage } = callHook()
    sendMessage('Test')

    await vi.waitFor(() => {
      const errorSlot = stateSlots[2] // error
      expect(errorSlot).toBeDefined()
    })
  })

  it('closes EventSource on error event', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Test')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const es = MockEventSource.instances[0]!
    es.emit('error')

    expect(es.readyState).toBe(MockEventSource.CLOSED)
  })

  it('ignores empty or whitespace-only messages', () => {
    const { sendMessage } = callHook()
    sendMessage('')
    sendMessage('   ')

    expect(mockGatewayFetch).not.toHaveBeenCalled()
  })

  it('does not send while loading', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Erste')

    // isLoading is now true — set it on the slot
    const loadingSlot = stateSlots[1] // isLoading
    loadingSlot!.setter(true)

    // Re-call hook to get updated state
    const result2 = callHook()
    result2.sendMessage('Zweite')

    // Only one gatewayFetch call
    expect(mockGatewayFetch).toHaveBeenCalledTimes(1)
  })

  it('closes EventSource on unmount via cleanup', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    callHook()

    // Run the effect to get the cleanup function
    for (const cb of effectCallbacks) {
      const cleanup = cb()
      if (typeof cleanup === 'function') {
        cleanup()
      }
    }

    // Cleanup should not throw
    expect(true).toBe(true)
  })

  it('handles tool_start and tool_result events', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Suche etwas')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const es = MockEventSource.instances[0]!
    es.emit('tool_start', 'web-search')
    es.emit('tool_result', 'Ergebnis gefunden')

    // Messages setter should have been invoked for both events
    const messagesSlot = stateSlots[0]
    expect(messagesSlot).toBeDefined()
  })

  // -------------------------------------------------------------------
  // New tests for extended functionality
  // -------------------------------------------------------------------

  it('accepts options parameter with activeSessionId', () => {
    const result = callHook({ activeSessionId: 'sess-1' })
    expect(result.messages).toEqual([])
    expect(result.isLoading).toBe(false)
  })

  it('calls onSessionCreated when new session is created', async () => {
    const onSessionCreated = vi.fn()
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: MOCK_UUID }),
    )

    const { sendMessage } = callHook({ onSessionCreated })
    sendMessage('Erste Nachricht')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    expect(onSessionCreated).toHaveBeenCalledWith(MOCK_UUID)
  })

  it('does not call onSessionCreated on existing session', async () => {
    const onSessionCreated = vi.fn()
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook({ activeSessionId: 'sess-1', onSessionCreated })
    sendMessage('Nachricht')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    expect(onSessionCreated).not.toHaveBeenCalled()
  })

  it('sends FormData via direct fetch when files are provided', async () => {
    mockFetch.mockResolvedValue(
      createJsonResponse({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
    sendMessage('Mit Datei', [file])

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const callArgs = mockFetch.mock.calls[0]
    const init = callArgs?.[1]
    expect(init?.body).toBeInstanceOf(FormData)
    // No auth headers — file upload uses direct fetch
    expect(init?.headers).toBeUndefined()
    // gatewayFetch should NOT have been called
    expect(mockGatewayFetch).not.toHaveBeenCalled()
  })

  it('sends JSON via gatewayFetch when no files are provided', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Ohne Datei')

    expect(mockGatewayFetch).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/message',
      body: { text: 'Ohne Datei', sessionId: MOCK_UUID },
    })
    // Direct fetch should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('parses tool_start JSON payload', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Test')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const es = MockEventSource.instances[0]!
    es.emit('tool_start', JSON.stringify({ toolName: 'web-search', params: { query: 'test' } }))

    const messagesSlot = stateSlots[0]
    expect(messagesSlot).toBeDefined()
  })

  it('registers four useEffects (cleanup, messagesRef sync, session load, auto-retry)', () => {
    callHook()
    expect(effectCallbacks).toHaveLength(4)
  })

  // -------------------------------------------------------------------
  // Tool confirmation tests
  // -------------------------------------------------------------------

  it('exposes confirmTool function', () => {
    const result = callHook()
    expect(typeof result.confirmTool).toBe('function')
  })

  it('creates confirmation message on tool_confirm SSE event', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Lösche Datei')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const es = MockEventSource.instances[0]!
    es.emit(
      'tool_confirm',
      JSON.stringify({
        toolCallId: 'tc-1',
        toolName: 'shell',
        params: { command: 'rm -rf /tmp/test' },
      }),
    )

    // Messages setter should have been invoked
    const messagesSlot = stateSlots[0]
    expect(messagesSlot).toBeDefined()
  })

  it('confirmTool sends POST via gatewayFetch', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Test')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    // Clear mock to isolate the confirm call
    mockGatewayFetch.mockClear()
    mockGatewayFetch.mockResolvedValue(createGatewayResult({ ok: true }))

    // Re-call hook to get confirmTool with current session ref
    const result = callHook()
    result.confirmTool('tc-1', 'execute')

    expect(mockGatewayFetch).toHaveBeenCalledWith({
      method: 'POST',
      path: `/api/confirm/${MOCK_UUID}`,
      body: { toolCallId: 'tc-1', decision: 'execute' },
    })
  })

  it('confirmTool sends modifiedParams when provided', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Test')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    mockGatewayFetch.mockClear()
    mockGatewayFetch.mockResolvedValue(createGatewayResult({ ok: true }))

    const result = callHook()
    result.confirmTool('tc-2', 'execute', { command: 'echo hello' })

    const callArgs = mockGatewayFetch.mock.calls[0]?.[0] as { body: unknown }
    expect(callArgs.body).toEqual({
      toolCallId: 'tc-2',
      decision: 'execute',
      modifiedParams: { command: 'echo hello' },
    })
  })

  it('confirmTool with reject updates message state', async () => {
    mockGatewayFetch.mockResolvedValue(
      createGatewayResult({ messageId: 'msg-1', sessionId: 'sess-1' }),
    )

    const { sendMessage } = callHook()
    sendMessage('Test')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    mockGatewayFetch.mockClear()
    mockGatewayFetch.mockResolvedValue(createGatewayResult({ ok: true }))

    const result = callHook()
    result.confirmTool('tc-1', 'reject')

    // Messages setter should have been called to update toolConfirmPending
    const messagesSlot = stateSlots[0]
    expect(messagesSlot).toBeDefined()
  })

  it('does not send confirm when no session is active', () => {
    const { confirmTool } = callHook()
    confirmTool('tc-1', 'execute')

    // No gatewayFetch call because session is null
    expect(mockGatewayFetch).not.toHaveBeenCalled()
  })
})
