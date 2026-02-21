import {
  encrypt,
  decrypt,
  encodeMessage,
  decodeMessage,
  toBase64,
  fromBase64,
} from '@ki-assistent/shared'
import type { DecryptedMessage } from '../types'

type MessageHandler = (message: DecryptedMessage) => void
type StatusHandler = (online: boolean) => void

interface RelayConfig {
  relayUrl: string
  jwt: string
  privateKey: Uint8Array
  partnerPublicKey: Uint8Array
}

const PING_INTERVAL = 30_000
const INITIAL_RECONNECT_DELAY = 3_000
const MAX_RECONNECT_DELAY = 60_000

export class RelayService {
  private ws: WebSocket | null = null
  private config: RelayConfig | null = null
  private messageHandlers = new Set<MessageHandler>()
  private statusHandlers = new Set<StatusHandler>()
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = INITIAL_RECONNECT_DELAY
  private intentionalClose = false

  configure(config: RelayConfig): void {
    this.config = config
  }

  connect(): void {
    if (!this.config) {
      throw new Error('RelayService not configured — call configure() first')
    }
    if (this.ws) {
      return
    }

    this.intentionalClose = false
    const wsUrl = this.config.relayUrl.replace(/^http/, 'ws')
    this.ws = new WebSocket(`${wsUrl}/ws?token=${this.config.jwt}`)

    this.ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY
      this.startPing()
    }

    this.ws.onmessage = (event: WebSocketMessageEvent) => {
      this.handleRawMessage(event.data as string)
    }

    this.ws.onclose = () => {
      this.cleanup()
      if (!this.intentionalClose) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      // onclose will fire after onerror
    }
  }

  disconnect(): void {
    this.intentionalClose = true
    this.cleanup()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  send(text: string): void {
    if (!this.ws || !this.config) {
      throw new Error('Not connected')
    }

    const bytes = encodeMessage(text)
    const encrypted = encrypt(bytes, this.config.partnerPublicKey, this.config.privateKey)
    const payload = toBase64(encrypted)

    this.ws.send(JSON.stringify({ type: 'message', payload }))
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => {
      this.messageHandlers.delete(handler)
    }
  }

  onPartnerStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private handleRawMessage(raw: string): void {
    let envelope: { type: string; payload?: string }
    try {
      envelope = JSON.parse(raw) as { type: string; payload?: string }
    } catch {
      return
    }

    if (envelope.type === 'partner_online') {
      for (const handler of this.statusHandlers) handler(true)
      return
    }
    if (envelope.type === 'partner_offline') {
      for (const handler of this.statusHandlers) handler(false)
      return
    }
    if (envelope.type === 'pong' || envelope.type === 'ack') {
      return
    }

    if (envelope.type === 'message' && envelope.payload && this.config) {
      try {
        const encrypted = fromBase64(envelope.payload)
        const decrypted = decrypt(encrypted, this.config.partnerPublicKey, this.config.privateKey)
        const text = decodeMessage(decrypted)
        const message = JSON.parse(text) as DecryptedMessage
        for (const handler of this.messageHandlers) handler(message)
      } catch {
        // Decryption or parse failure — skip silently
      }
    }
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, PING_INTERVAL)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private cleanup(): void {
    this.stopPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.ws = null
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY)
  }
}
