import { useCallback, useEffect, useRef, useState } from 'react'
import { fromBase64 } from '@ki-assistent/shared'
import { RelayService } from '../services/relay'
import { usePairing } from '../contexts/PairingContext'
import { useAuthContext } from '../contexts/AuthContext'
import type { ChatMessage, ConnectionStatus, DecryptedMessage, ToolCallInfo } from '../types'

let idCounter = 0
function nextId(): string {
  return `msg-${Date.now().toString(36)}-${(idCounter++).toString(36)}`
}

interface UseChatResult {
  messages: ChatMessage[]
  isStreaming: boolean
  connectionStatus: ConnectionStatus
  partnerOnline: boolean
  sendMessage: (text: string) => Promise<void>
}

export function useChat(): UseChatResult {
  const { data: pairing } = usePairing()
  const { getToken: getClerkToken, clerkEnabled } = useAuthContext()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [partnerOnline, setPartnerOnline] = useState(false)
  const relayRef = useRef<RelayService | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pairing) return

    const relay = new RelayService()
    relayRef.current = relay

    relay.configure({
      relayUrl: pairing.relayUrl,
      jwt: pairing.jwt,
      privateKey: fromBase64(pairing.privateKey),
      partnerPublicKey: fromBase64(pairing.partnerPublicKey),
    })

    const unsubMessage = relay.onMessage((msg: DecryptedMessage) => {
      handleMessage(msg)
    })

    const unsubStatus = relay.onPartnerStatus((online: boolean) => {
      setPartnerOnline(online)
    })

    setConnectionStatus('connecting')
    relay.connect()

    // Track connection state via polling (RN WebSocket doesn't expose readyState changes)
    const statusInterval = setInterval(() => {
      if (relay.isConnected) {
        setConnectionStatus('connected')
      } else {
        setConnectionStatus('connecting')
      }
    }, 1000)

    return () => {
      unsubMessage()
      unsubStatus()
      clearInterval(statusInterval)
      relay.disconnect()
      relayRef.current = null
    }
  }, [pairing])

  const handleMessage = useCallback((msg: DecryptedMessage) => {
    switch (msg.type) {
      case 'stream_start': {
        const id = nextId()
        currentAssistantIdRef.current = id
        setIsStreaming(true)
        setMessages((prev) => [
          ...prev,
          { id, role: 'assistant', content: '', timestamp: new Date().toISOString(), pending: true },
        ])
        break
      }

      case 'stream_token': {
        const assistantId = currentAssistantIdRef.current
        if (assistantId && msg.content) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + msg.content } : m,
            ),
          )
        }
        break
      }

      case 'stream_end': {
        const assistantId = currentAssistantIdRef.current
        if (assistantId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
          )
        }
        currentAssistantIdRef.current = null
        setIsStreaming(false)
        break
      }

      case 'message': {
        const id = nextId()
        setMessages((prev) => [
          ...prev,
          {
            id,
            role: 'assistant',
            content: msg.content ?? '',
            timestamp: new Date().toISOString(),
          },
        ])
        setIsStreaming(false)
        break
      }

      case 'tool_call': {
        const assistantId = currentAssistantIdRef.current
        if (assistantId && msg.toolCall) {
          const toolInfo: ToolCallInfo = {
            name: msg.toolCall.name,
            args: msg.toolCall.args,
            status: 'running',
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, toolCalls: [...(m.toolCalls ?? []), toolInfo] }
                : m,
            ),
          )
        }
        break
      }

      case 'tool_result': {
        const assistantId = currentAssistantIdRef.current
        if (assistantId && msg.toolResult) {
          const resultName = msg.toolResult.name
          const resultData = msg.toolResult.result
          const resultStatus = msg.toolResult.status === 'error' ? 'error' as const : 'done' as const
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId || !m.toolCalls) return m
              const updatedTools = m.toolCalls.map((tc) =>
                tc.name === resultName && tc.status === 'running'
                  ? { ...tc, result: resultData, status: resultStatus }
                  : tc,
              )
              return { ...m, toolCalls: updatedTools }
            }),
          )
        }
        break
      }

      case 'error': {
        const id = nextId()
        setMessages((prev) => [
          ...prev,
          {
            id,
            role: 'assistant',
            content: `Error: ${msg.message ?? 'Unknown error'}`,
            timestamp: new Date().toISOString(),
          },
        ])
        setIsStreaming(false)
        break
      }

      case 'notification': {
        if (msg.notification) {
          const id = nextId()
          const n = msg.notification
          const prefix = `[${n.agentName}] `
          setMessages((prev) => [
            ...prev,
            {
              id,
              role: 'assistant',
              content: prefix + n.summary,
              timestamp: new Date().toISOString(),
            },
          ])
        }
        break
      }
    }
  }, [])

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      const relay = relayRef.current
      if (!relay || !text.trim()) return

      // Optimistic UI
      const id = nextId()
      setMessages((prev) => [
        ...prev,
        { id, role: 'user', content: text, timestamp: new Date().toISOString() },
      ])

      try {
        const payload: Record<string, unknown> = { type: 'message', content: text }
        if (clerkEnabled) {
          const token = await getClerkToken()
          if (token) {
            payload['clerkToken'] = token
          }
        }
        relay.send(JSON.stringify(payload))
      } catch {
        // Connection lost — message will be shown but not delivered
      }
    },
    [clerkEnabled, getClerkToken],
  )

  return { messages, isStreaming, connectionStatus, partnerOnline, sendMessage }
}
