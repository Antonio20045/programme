import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockResolveResult = { mode: 'local' as const, url: 'http://127.0.0.1:18789', token: '' }
let configChangedCallback: ((config: unknown) => void) | null = null
const mockUnsubscribe = vi.fn()
const mockUpdateCachedConfig = vi.fn()

vi.mock('../config', () => ({
  resolveGatewayConfig: () => Promise.resolve(mockResolveResult),
  updateCachedConfig: (...args: unknown[]) => mockUpdateCachedConfig(...args),
}))

const mockWindowApi = {
  onGatewayConfigChanged: vi.fn((cb: (config: unknown) => void) => {
    configChangedCallback = cb
    return mockUnsubscribe
  }),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockWindowApi },
  writable: true,
})

// Mock React hooks
let useStateCalls: Array<[unknown, (v: unknown) => void]> = []
let useEffectCallbacks: Array<() => (() => void) | void> = []
let stateIndex = 0
let effectIndex = 0

/* eslint-disable security/detect-object-injection */
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const idx = stateIndex++
    if (!useStateCalls[idx]) {
      const entry: [unknown, (v: unknown) => void] = [initial, vi.fn()]
      entry[1] = vi.fn((v: unknown) => {
        entry[0] = typeof v === 'function' ? (v as (prev: unknown) => unknown)(entry[0]) : v
      })
      useStateCalls[idx] = entry
    }
    return useStateCalls[idx]
  },
  useEffect: (cb: () => (() => void) | void) => {
    useEffectCallbacks[effectIndex++] = cb
  },
}))
/* eslint-enable security/detect-object-injection */

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useGatewayConfig } from '../hooks/useGatewayConfig'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMockState(): void {
  useStateCalls = []
  useEffectCallbacks = []
  stateIndex = 0
  effectIndex = 0
  configChangedCallback = null
  mockUnsubscribe.mockClear()
  mockUpdateCachedConfig.mockClear()
  mockWindowApi.onGatewayConfigChanged.mockClear()
}

function callHook(): ReturnType<typeof useGatewayConfig> {
  stateIndex = 0
  effectIndex = 0
  return useGatewayConfig()
}

function runEffects(): void {
  for (const cb of useEffectCallbacks) {
    cb()
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGatewayConfig', () => {
  beforeEach(() => {
    resetMockState()
    mockResolveResult = { mode: 'local', url: 'http://127.0.0.1:18789', token: '' }
  })

  it('returns default local mode initially', () => {
    const result = callHook()
    expect(result.mode).toBe('local')
    expect(result.loading).toBe(true)
    expect(result.serverUrl).toBe('')
    expect(result.tokenLast4).toBe('')
  })

  it('registers onGatewayConfigChanged listener on mount', () => {
    callHook()
    runEffects()
    expect(mockWindowApi.onGatewayConfigChanged).toHaveBeenCalledOnce()
  })

  it('returns unsubscribe function from effect', () => {
    callHook()
    const cleanups = useEffectCallbacks.map((cb) => cb())
    expect(cleanups[0]).toBe(mockUnsubscribe)
  })

  it('calls resolveGatewayConfig on mount', async () => {
    callHook()
    runEffects()
    // Allow microtask to resolve
    await Promise.resolve()
    const setState = useStateCalls[0]?.[1]
    expect(setState).toHaveBeenCalled()
  })

  it('updates state with server mode config', async () => {
    mockResolveResult = { mode: 'server', url: 'https://remote.example.com', token: 'ab12' }
    callHook()
    runEffects()
    await Promise.resolve()

    const lastSetState = useStateCalls[0]?.[1] as ReturnType<typeof vi.fn>
    const call = lastSetState.mock.calls[0]?.[0]
    expect(call).toEqual({
      mode: 'server',
      serverUrl: 'https://remote.example.com',
      tokenLast4: 'ab12',
      loading: false,
    })
  })

  it('handles config changed event in local mode', () => {
    callHook()
    runEffects()

    expect(configChangedCallback).not.toBeNull()
    configChangedCallback!({ mode: 'local', serverUrl: '', token: '' })

    expect(mockUpdateCachedConfig).toHaveBeenCalledWith('local', '')
  })

  it('handles config changed event in server mode', () => {
    callHook()
    runEffects()

    configChangedCallback!({ mode: 'server', serverUrl: 'https://remote.example.com', token: 'lue!' })

    expect(mockUpdateCachedConfig).toHaveBeenCalledWith('server', 'https://remote.example.com')
  })

  it('rejects invalid config change payloads', () => {
    callHook()
    runEffects()

    // Should not throw or update state
    configChangedCallback!('invalid')
    configChangedCallback!(null)
    configChangedCallback!(42)
    expect(mockUpdateCachedConfig).not.toHaveBeenCalled()
  })

  it('is exported as a function', () => {
    expect(typeof useGatewayConfig).toBe('function')
  })
})
