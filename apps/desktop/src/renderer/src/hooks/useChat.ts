import { useState, useEffect, useRef, useCallback } from 'react'
import { GATEWAY_URL } from '../config'

interface ChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly toolName?: string
  readonly toolParams?: Record<string, unknown>
  readonly toolResult?: unknown
  readonly toolStartedAt?: number
  readonly toolFinishedAt?: number
}

interface UseChatOptions {
  readonly activeSessionId?: string | null
  readonly onSessionCreated?: (sessionId: string) => void
}

interface UseChatReturn {
  readonly messages: readonly ChatMessage[]
  readonly isLoading: boolean
  readonly error: string | null
  sendMessage: (text: string, files?: File[]) => void
}

interface MessageResponse {
  readonly messageId: string
  readonly sessionId: string
}

function isMessageResponse(data: unknown): data is MessageResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'messageId' in data &&
    'sessionId' in data &&
    typeof (data as MessageResponse).messageId === 'string' &&
    typeof (data as MessageResponse).sessionId === 'string'
  )
}

interface StoredMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly toolName?: string
  readonly toolResult?: string
}

function isStoredMessageArray(data: unknown): data is StoredMessage[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        typeof (item as StoredMessage).id === 'string' &&
        'role' in item &&
        'content' in item,
    )
  )
}

interface ToolStartPayload {
  readonly toolName: string
  readonly params?: Record<string, unknown>
}

function isToolStartPayload(data: unknown): data is ToolStartPayload {
  return (
    typeof data === 'object' &&
    data !== null &&
    'toolName' in data &&
    typeof (data as ToolStartPayload).toolName === 'string'
  )
}

interface ToolResultPayload {
  readonly toolName: string
  readonly result: unknown
}

function isToolResultPayload(data: unknown): data is ToolResultPayload {
  return (
    typeof data === 'object' &&
    data !== null &&
    'toolName' in data &&
    typeof (data as ToolResultPayload).toolName === 'string' &&
    'result' in data
  )
}

export function useChat(options?: UseChatOptions): UseChatReturn {
  const activeSessionId = options?.activeSessionId ?? null
  const onSessionCreated = options?.onSessionCreated

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const assistantBufferRef = useRef('')
  const assistantIdRef = useRef('')
  const currentSessionIdRef = useRef<string | null>(activeSessionId)

  // Close EventSource on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
    }
  }, [])

  // Load messages when activeSessionId changes
  useEffect(() => {
    if (activeSessionId === currentSessionIdRef.current) return

    currentSessionIdRef.current = activeSessionId

    // Close any active stream
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    setIsLoading(false)
    setError(null)

    if (activeSessionId === null) {
      setMessages([])
      return
    }

    fetch(`${GATEWAY_URL}/api/sessions/${activeSessionId}/messages`)
      .then((res) => {
        if (!res.ok) throw new Error(`Status ${res.status.toString()}`)
        return res.json() as Promise<unknown>
      })
      .then((data) => {
        if (!isStoredMessageArray(data)) throw new Error('Ungültige Nachrichten')
        const chatMessages: ChatMessage[] = data.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          ...(m.toolName !== undefined
            ? { toolName: m.toolName, toolStartedAt: 0, toolFinishedAt: 0, toolParams: {} }
            : {}),
        }))
        setMessages(chatMessages)
      })
      .catch(() => {
        setMessages([])
      })
  }, [activeSessionId])

  const sendMessage = useCallback(
    (text: string, files?: File[]) => {
      const trimmed = text.trim()
      if (trimmed.length === 0 || isLoading) return

      setError(null)
      setIsLoading(true)

      // Add user message
      const userMsg: ChatMessage = {
        id: `user-${Date.now().toString(36)}`,
        role: 'user',
        content: trimmed,
      }
      setMessages((prev) => [...prev, userMsg])

      // Close any existing EventSource
      eventSourceRef.current?.close()
      eventSourceRef.current = null

      const sessionId = currentSessionIdRef.current

      // Build request — multipart/form-data when files attached, JSON otherwise
      let fetchInit: RequestInit
      if (files !== undefined && files.length > 0) {
        const formData = new FormData()
        formData.append('text', trimmed)
        if (sessionId !== null) {
          formData.append('sessionId', sessionId)
        }
        for (const file of files) {
          formData.append('files', file)
        }
        fetchInit = { method: 'POST', body: formData }
      } else {
        fetchInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed, sessionId }),
        }
      }

      // POST to gateway
      fetch(`${GATEWAY_URL}/api/message`, fetchInit)
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Gateway antwortet mit Status ${res.status.toString()}`)
          }
          return res.json() as Promise<unknown>
        })
        .then((data) => {
          if (!isMessageResponse(data)) {
            throw new Error('Ungültige Antwort vom Gateway')
          }

          // Track new session
          if (currentSessionIdRef.current === null) {
            currentSessionIdRef.current = data.sessionId
            onSessionCreated?.(data.sessionId)
          }

          // Prepare assistant message buffer
          assistantBufferRef.current = ''
          assistantIdRef.current = data.messageId

          const assistantMsg: ChatMessage = {
            id: data.messageId,
            role: 'assistant',
            content: '',
          }
          setMessages((prev) => [...prev, assistantMsg])

          // Open SSE stream
          const es = new EventSource(
            `${GATEWAY_URL}/api/stream/${data.sessionId}`,
          )
          eventSourceRef.current = es

          es.addEventListener('token', (e: MessageEvent<string>) => {
            assistantBufferRef.current += e.data
            const currentContent = assistantBufferRef.current
            const currentId = assistantIdRef.current
            setMessages((prev) =>
              prev.map((m) =>
                m.id === currentId ? { ...m, content: currentContent } : m,
              ),
            )
          })

          es.addEventListener('tool_start', (e: MessageEvent<string>) => {
            let toolName = e.data
            let params: Record<string, unknown> = {}
            try {
              const parsed: unknown = JSON.parse(e.data)
              if (isToolStartPayload(parsed)) {
                toolName = parsed.toolName
                params = parsed.params ?? {}
              }
            } catch {
              // plain string tool name — use as-is
            }

            const toolMsg: ChatMessage = {
              id: `tool-${Date.now().toString(36)}`,
              role: 'assistant',
              content: '',
              toolName,
              toolParams: params,
              toolStartedAt: Date.now(),
            }
            setMessages((prev) => [...prev, toolMsg])
          })

          es.addEventListener('tool_result', (e: MessageEvent<string>) => {
            let matchToolName: string | undefined
            let result: unknown = e.data
            try {
              const parsed: unknown = JSON.parse(e.data)
              if (isToolResultPayload(parsed)) {
                matchToolName = parsed.toolName
                result = parsed.result
              }
            } catch {
              // plain string result
            }

            setMessages((prev) => {
              // Find the last unfinished tool message
              const reversed = [...prev].reverse()
              const idx = reversed.findIndex(
                (m) =>
                  m.toolStartedAt !== undefined &&
                  m.toolFinishedAt === undefined &&
                  (matchToolName === undefined || m.toolName === matchToolName),
              )
              if (idx === -1) return prev
              const actualIdx = prev.length - 1 - idx
              const target = prev[actualIdx]
              if (!target) return prev
              return prev.map((m, i) =>
                i === actualIdx
                  ? { ...m, toolResult: result, toolFinishedAt: Date.now() }
                  : m,
              )
            })
          })

          es.addEventListener('done', () => {
            es.close()
            eventSourceRef.current = null
            setIsLoading(false)
          })

          es.addEventListener('error', (e: Event) => {
            es.close()
            eventSourceRef.current = null
            setIsLoading(false)
            const eventSource = e.target as EventSource | null
            if (eventSource?.readyState === EventSource.CLOSED) {
              setError('Verbindung zum Gateway verloren')
            } else {
              setError('Stream-Fehler aufgetreten')
            }
          })
        })
        .catch((err: unknown) => {
          setIsLoading(false)
          const message =
            err instanceof Error ? err.message : 'Unbekannter Fehler'
          setError(message)
        })
    },
    [isLoading, onSessionCreated],
  )

  return { messages, isLoading, error, sendMessage }
}

export type { ChatMessage, UseChatReturn, UseChatOptions }
