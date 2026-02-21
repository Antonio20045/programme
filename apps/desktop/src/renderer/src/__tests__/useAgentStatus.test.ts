import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock window.api
const mockAgentStatus = vi.fn<[], Promise<string>>()
const mockOnAgentStatus = vi.fn<[(status: string) => void], () => void>()

vi.stubGlobal('window', {
  api: {
    agentStatus: mockAgentStatus,
    onAgentStatus: mockOnAgentStatus,
  },
})

// Mock React hooks
const mockSetState = vi.fn()
let effectCallback: (() => (() => void) | void) | null = null

vi.mock('react', () => ({
  useState: (initial: unknown) => [initial, mockSetState],
  useEffect: (cb: () => (() => void) | void) => {
    effectCallback = cb
  },
}))

// Mock useGatewayConfig
vi.mock('../hooks/useGatewayConfig', () => ({
  useGatewayConfig: () => ({ mode: 'server', serverUrl: '', tokenLast4: '', loading: false }),
}))

import { useAgentStatus } from '../hooks/useAgentStatus'

describe('useAgentStatus', () => {
  const mockUnsubscribe = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    effectCallback = null
    mockAgentStatus.mockResolvedValue('connected')
    mockOnAgentStatus.mockReturnValue(mockUnsubscribe)
  })

  it('returns local as initial status', () => {
    const result = useAgentStatus()
    expect(result).toBe('local')
  })

  it('fetches agent status on mount in server mode', () => {
    useAgentStatus()
    expect(effectCallback).not.toBeNull()
    effectCallback!()
    expect(mockAgentStatus).toHaveBeenCalledTimes(1)
  })

  it('subscribes to agent status updates', () => {
    useAgentStatus()
    effectCallback!()
    expect(mockOnAgentStatus).toHaveBeenCalledTimes(1)
    expect(mockOnAgentStatus).toHaveBeenCalledWith(expect.any(Function))
  })

  it('returns unsubscribe as cleanup', () => {
    useAgentStatus()
    const cleanup = effectCallback!()
    expect(cleanup).toBe(mockUnsubscribe)
  })

  it('updates status when fetch resolves', async () => {
    mockAgentStatus.mockResolvedValue('connected')
    useAgentStatus()
    effectCallback!()
    await vi.waitFor(() => {
      expect(mockSetState).toHaveBeenCalledWith('connected')
    })
  })
})
