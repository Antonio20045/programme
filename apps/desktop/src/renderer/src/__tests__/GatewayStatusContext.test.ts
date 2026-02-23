import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock window.api before importing the context
// ---------------------------------------------------------------------------

const mockGetGatewayStatus = vi.fn<[], Promise<string>>()
const mockOnGatewayStatus = vi.fn<[(status: string) => void], () => void>()

vi.stubGlobal('window', {
  api: {
    getGatewayStatus: mockGetGatewayStatus,
    onGatewayStatus: mockOnGatewayStatus,
  },
})

// Shared state for React mock — vi.hoisted ensures it's available before vi.mock runs
const mockState = vi.hoisted(() => ({
  setState: vi.fn(),
  effectCallback: null as (() => (() => void) | void) | null,
  contextDefault: null as unknown,
}))

vi.mock('react', () => ({
  useState: (initial: unknown) => [initial, mockState.setState],
  useEffect: (cb: () => (() => void) | void) => {
    mockState.effectCallback = cb
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useContext: (ctx: { _currentValue: unknown }) => ctx._currentValue,
  createContext: (defaultValue: unknown) => {
    mockState.contextDefault = defaultValue
    return { _currentValue: defaultValue, Provider: 'MockProvider' }
  },
}))

import { useGatewayStatus, GatewayStatusProvider } from '../contexts/GatewayStatusContext'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GatewayStatusContext', () => {
  const mockUnsubscribe = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockState.effectCallback = null
    mockGetGatewayStatus.mockResolvedValue('online')
    mockOnGatewayStatus.mockReturnValue(mockUnsubscribe)
  })

  it('exports useGatewayStatus hook', () => {
    expect(typeof useGatewayStatus).toBe('function')
  })

  it('exports GatewayStatusProvider component', () => {
    expect(typeof GatewayStatusProvider).toBe('function')
  })

  it('creates context with starting as default', () => {
    expect(mockState.contextDefault).toBe('starting')
  })

  it('subscribes to IPC events and fetches initial status', () => {
    GatewayStatusProvider({ children: null })
    expect(mockState.effectCallback).not.toBeNull()

    mockState.effectCallback!()

    expect(mockOnGatewayStatus).toHaveBeenCalledTimes(1)
    expect(mockOnGatewayStatus).toHaveBeenCalledWith(expect.any(Function))
    expect(mockGetGatewayStatus).toHaveBeenCalledTimes(1)
  })

  it('updates status when initial fetch resolves', async () => {
    mockGetGatewayStatus.mockResolvedValue('online')

    GatewayStatusProvider({ children: null })
    mockState.effectCallback!()

    await vi.waitFor(() => {
      expect(mockState.setState).toHaveBeenCalledWith('online')
    })
  })

  it('sets offline when initial fetch fails', async () => {
    mockGetGatewayStatus.mockRejectedValue(new Error('IPC failed'))

    GatewayStatusProvider({ children: null })
    mockState.effectCallback!()

    await vi.waitFor(() => {
      expect(mockState.setState).toHaveBeenCalledWith('offline')
    })
  })

  it('IPC event updates status', () => {
    GatewayStatusProvider({ children: null })
    mockState.effectCallback!()

    const ipcCallback = mockOnGatewayStatus.mock.calls[0]![0]
    ipcCallback('offline')
    expect(mockState.setState).toHaveBeenCalledWith('offline')
  })

  it('ignores invalid status values from IPC', () => {
    GatewayStatusProvider({ children: null })
    mockState.effectCallback!()

    const ipcCallback = mockOnGatewayStatus.mock.calls[0]![0]
    ipcCallback('invalid-status')

    const invalidCalls = mockState.setState.mock.calls.filter(
      (c: unknown[]) => c[0] === 'invalid-status',
    )
    expect(invalidCalls).toHaveLength(0)
  })

  it('returns unsubscribe as cleanup', () => {
    GatewayStatusProvider({ children: null })
    const cleanup = mockState.effectCallback!()
    expect(cleanup).toBe(mockUnsubscribe)
  })
})
