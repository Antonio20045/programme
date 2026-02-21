import { renderHook, act } from '@testing-library/react-native'
import type { DecryptedMessage } from '../types'

// --- Mocks ---
let messageHandler: ((msg: DecryptedMessage) => void) | null = null
let statusHandler: ((online: boolean) => void) | null = null

const mockRelay = {
  configure: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  send: jest.fn(),
  isConnected: true,
  onMessage: jest.fn((handler: (msg: DecryptedMessage) => void) => {
    messageHandler = handler
    return () => { messageHandler = null }
  }),
  onPartnerStatus: jest.fn((handler: (online: boolean) => void) => {
    statusHandler = handler
    return () => { statusHandler = null }
  }),
}

jest.mock('../services/relay', () => ({
  RelayService: jest.fn().mockImplementation(() => mockRelay),
}))

jest.mock('../contexts/PairingContext', () => ({
  usePairing: () => ({
    data: {
      relayUrl: 'https://relay.example.com',
      jwt: 'test-jwt',
      privateKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      partnerPublicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
      deviceId: 'device-1',
      partnerDeviceId: 'device-2',
    },
  }),
}))

jest.mock('@ki-assistent/shared', () => ({
  fromBase64: (s: string) => new Uint8Array(32),
}))

import { useChat } from '../hooks/useChat'

beforeEach(() => {
  jest.clearAllMocks()
  messageHandler = null
  statusHandler = null
})

describe('useChat', () => {
  it('connects on mount and disconnects on unmount', () => {
    const { unmount } = renderHook(() => useChat())
    expect(mockRelay.connect).toHaveBeenCalled()
    unmount()
    expect(mockRelay.disconnect).toHaveBeenCalled()
  })

  it('sends message with optimistic UI', () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      result.current.sendMessage('Hello')
    })

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]?.role).toBe('user')
    expect(result.current.messages[0]?.content).toBe('Hello')
    expect(mockRelay.send).toHaveBeenCalled()
  })

  it('handles stream_start + stream_token + stream_end', () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      messageHandler?.({ type: 'stream_start' })
    })

    expect(result.current.isStreaming).toBe(true)
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]?.role).toBe('assistant')
    expect(result.current.messages[0]?.content).toBe('')

    act(() => {
      messageHandler?.({ type: 'stream_token', content: 'Hello ' })
    })

    expect(result.current.messages[0]?.content).toBe('Hello ')

    act(() => {
      messageHandler?.({ type: 'stream_token', content: 'World' })
    })

    expect(result.current.messages[0]?.content).toBe('Hello World')

    act(() => {
      messageHandler?.({ type: 'stream_end' })
    })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.messages[0]?.pending).toBe(false)
  })

  it('handles complete message', () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      messageHandler?.({ type: 'message', content: 'Complete response' })
    })

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]?.content).toBe('Complete response')
  })

  it('handles tool_call and tool_result', () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      messageHandler?.({ type: 'stream_start' })
    })

    act(() => {
      messageHandler?.({
        type: 'tool_call',
        toolCall: { name: 'web-search', args: { query: 'test' } },
      })
    })

    expect(result.current.messages[0]?.toolCalls).toHaveLength(1)
    expect(result.current.messages[0]?.toolCalls?.[0]?.status).toBe('running')

    act(() => {
      messageHandler?.({
        type: 'tool_result',
        toolResult: { name: 'web-search', result: 'Found 5 results', status: 'done' },
      })
    })

    expect(result.current.messages[0]?.toolCalls?.[0]?.status).toBe('done')
    expect(result.current.messages[0]?.toolCalls?.[0]?.result).toBe('Found 5 results')
  })

  it('handles error messages', () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      messageHandler?.({ type: 'error', message: 'Something went wrong' })
    })

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]?.content).toContain('Something went wrong')
    expect(result.current.isStreaming).toBe(false)
  })

  it('does not send empty messages', () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      result.current.sendMessage('   ')
    })

    expect(result.current.messages).toHaveLength(0)
    expect(mockRelay.send).not.toHaveBeenCalled()
  })

  it('tracks partner online status', () => {
    const { result } = renderHook(() => useChat())

    expect(result.current.partnerOnline).toBe(false)

    act(() => {
      statusHandler?.(true)
    })

    expect(result.current.partnerOnline).toBe(true)
  })
})
