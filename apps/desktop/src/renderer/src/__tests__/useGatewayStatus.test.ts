import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock window.api before importing the hook
// ---------------------------------------------------------------------------

const mockGetGatewayStatus = vi.fn<[], Promise<string>>()
const mockOnGatewayStatus = vi.fn<[(status: string) => void], () => void>()

vi.stubGlobal('window', {
  api: {
    getGatewayStatus: mockGetGatewayStatus,
    onGatewayStatus: mockOnGatewayStatus,
  },
})

// Mock React hooks to test without DOM
const mockSetState = vi.fn()
let effectCallback: (() => (() => void) | void) | null = null

vi.mock('react', () => ({
  useState: (initial: unknown) => [initial, mockSetState],
  useEffect: (cb: () => (() => void) | void) => {
    effectCallback = cb
  },
}))

import { useGatewayStatus } from '../hooks/useGatewayStatus'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGatewayStatus', () => {
  const mockUnsubscribe = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    effectCallback = null
    mockGetGatewayStatus.mockResolvedValue('online')
    mockOnGatewayStatus.mockReturnValue(mockUnsubscribe)
  })

  it('returns starting as initial status', () => {
    const result = useGatewayStatus()
    expect(result).toBe('starting')
  })

  it('fetches initial status on mount', () => {
    useGatewayStatus()
    expect(effectCallback).not.toBeNull()

    effectCallback!()

    expect(mockGetGatewayStatus).toHaveBeenCalledTimes(1)
  })

  it('subscribes to status updates on mount', () => {
    useGatewayStatus()
    effectCallback!()

    expect(mockOnGatewayStatus).toHaveBeenCalledTimes(1)
    expect(mockOnGatewayStatus).toHaveBeenCalledWith(expect.any(Function))
  })

  it('returns unsubscribe as cleanup', () => {
    useGatewayStatus()
    const cleanup = effectCallback!()

    expect(cleanup).toBe(mockUnsubscribe)
  })

  it('updates status when initial fetch resolves', async () => {
    mockGetGatewayStatus.mockResolvedValue('online')

    useGatewayStatus()
    effectCallback!()

    // Flush the promise
    await vi.waitFor(() => {
      expect(mockSetState).toHaveBeenCalledWith('online')
    })
  })

  it('sets offline when initial fetch fails', async () => {
    mockGetGatewayStatus.mockRejectedValue(new Error('IPC failed'))

    useGatewayStatus()
    effectCallback!()

    await vi.waitFor(() => {
      expect(mockSetState).toHaveBeenCalledWith('offline')
    })
  })
})
