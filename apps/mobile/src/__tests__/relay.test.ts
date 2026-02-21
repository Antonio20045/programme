import { RelayService } from '../services/relay'
import { generateKeyPair, toBase64 } from '@ki-assistent/shared'

// --- Mock WebSocket ---
type WSHandler = ((event: { data: string }) => void) | (() => void) | null

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  closed = false

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
    setTimeout(() => this.onopen?.(), 0)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.readyState = MockWebSocket.CLOSED
  }

  static reset(): void {
    MockWebSocket.instances = []
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).WebSocket = MockWebSocket

beforeEach(() => {
  MockWebSocket.reset()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

function createConfig() {
  const keyPairA = generateKeyPair()
  const keyPairB = generateKeyPair()
  return {
    relayUrl: 'https://relay.example.com',
    jwt: 'test-jwt-token',
    privateKey: keyPairA.secretKey,
    partnerPublicKey: keyPairB.publicKey,
  }
}

describe('RelayService', () => {
  it('connects to the relay with correct URL', () => {
    const relay = new RelayService()
    relay.configure(createConfig())
    relay.connect()

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]?.url).toBe('wss://relay.example.com/ws?token=test-jwt-token')
  })

  it('throws if not configured', () => {
    const relay = new RelayService()
    expect(() => relay.connect()).toThrow('not configured')
  })

  it('throws when sending without connection', () => {
    const relay = new RelayService()
    relay.configure(createConfig())
    expect(() => relay.send('hello')).toThrow('Not connected')
  })

  it('sends encrypted messages', () => {
    const relay = new RelayService()
    relay.configure(createConfig())
    relay.connect()

    jest.advanceTimersByTime(1) // trigger onopen

    relay.send('hello world')
    expect(MockWebSocket.instances[0]?.sent).toHaveLength(1)

    const sent = JSON.parse(MockWebSocket.instances[0]!.sent[0]!) as { type: string; payload: string }
    expect(sent.type).toBe('message')
    expect(typeof sent.payload).toBe('string')
    // Payload should be base64 encoded encrypted data
    expect(sent.payload.length).toBeGreaterThan(0)
  })

  it('handles partner_online and partner_offline events', () => {
    const relay = new RelayService()
    relay.configure(createConfig())

    const statuses: boolean[] = []
    relay.onPartnerStatus((online) => statuses.push(online))

    relay.connect()
    jest.advanceTimersByTime(1)

    const ws = MockWebSocket.instances[0]!
    ws.onmessage?.({ data: JSON.stringify({ type: 'partner_online' }) })
    ws.onmessage?.({ data: JSON.stringify({ type: 'partner_offline' }) })

    expect(statuses).toEqual([true, false])
  })

  it('sends ping every 30 seconds', () => {
    const relay = new RelayService()
    relay.configure(createConfig())
    relay.connect()
    jest.advanceTimersByTime(1) // trigger onopen

    const ws = MockWebSocket.instances[0]!
    jest.advanceTimersByTime(30_000)

    const pings = ws.sent.filter((s) => {
      const parsed = JSON.parse(s) as { type: string }
      return parsed.type === 'ping'
    })
    expect(pings.length).toBeGreaterThanOrEqual(1)
  })

  it('cleans up on disconnect', () => {
    const relay = new RelayService()
    relay.configure(createConfig())
    relay.connect()
    jest.advanceTimersByTime(1)

    relay.disconnect()
    expect(MockWebSocket.instances[0]?.closed).toBe(true)
  })

  it('unsubscribe removes handler', () => {
    const relay = new RelayService()
    relay.configure(createConfig())

    const messages: unknown[] = []
    const unsub = relay.onMessage((msg) => messages.push(msg))
    unsub()

    relay.connect()
    jest.advanceTimersByTime(1)

    const ws = MockWebSocket.instances[0]!
    ws.onmessage?.({ data: JSON.stringify({ type: 'partner_online' }) })

    expect(messages).toHaveLength(0)
  })

  it('ignores malformed JSON messages', () => {
    const relay = new RelayService()
    relay.configure(createConfig())
    relay.connect()
    jest.advanceTimersByTime(1)

    const ws = MockWebSocket.instances[0]!
    // Should not throw
    ws.onmessage?.({ data: 'not json' })
    ws.onmessage?.({ data: '{}' })
  })

  it('schedules reconnect on unexpected close', () => {
    const relay = new RelayService()
    relay.configure(createConfig())
    relay.connect()
    jest.advanceTimersByTime(1)

    const ws = MockWebSocket.instances[0]!
    ws.onclose?.()

    // After reconnect delay, a new connection should be attempted
    jest.advanceTimersByTime(3000)
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2)
  })

  it('does not reconnect on intentional disconnect', () => {
    const relay = new RelayService()
    relay.configure(createConfig())
    relay.connect()
    jest.advanceTimersByTime(1)

    relay.disconnect()
    jest.advanceTimersByTime(60_000)

    // Only the original connection
    expect(MockWebSocket.instances).toHaveLength(1)
  })
})
