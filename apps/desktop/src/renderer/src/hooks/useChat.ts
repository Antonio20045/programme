import { useState, useEffect, useRef, useCallback } from 'react'
import { getGatewayUrl, getGatewayMode } from '../config'

interface ChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly toolName?: string
  readonly toolParams?: Record<string, unknown>
  readonly toolResult?: unknown
  readonly toolStartedAt?: number
  readonly toolFinishedAt?: number
  readonly toolConfirmPending?: boolean
  readonly toolCallId?: string
  readonly toolConfirmPreview?: ToolPreview
}

interface UseChatOptions {
  readonly activeSessionId?: string | null
  readonly onSessionCreated?: (sessionId: string) => void
}

interface OAuthTokens {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

interface UseChatReturn {
  readonly messages: readonly ChatMessage[]
  readonly isLoading: boolean
  readonly error: string | null
  sendMessage: (text: string, files?: File[]) => void
  confirmTool: (
    toolCallId: string,
    decision: 'execute' | 'reject',
    modifiedParams?: Record<string, unknown>,
    oauthTokens?: OAuthTokens,
  ) => void
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

interface ToolConfirmPayload {
  readonly toolCallId: string
  readonly toolName: string
  readonly params: Record<string, unknown>
}

function isToolConfirmPayload(data: unknown): data is ToolConfirmPayload {
  return (
    typeof data === 'object' &&
    data !== null &&
    'toolCallId' in data &&
    typeof (data as ToolConfirmPayload).toolCallId === 'string' &&
    'toolName' in data &&
    typeof (data as ToolConfirmPayload).toolName === 'string'
  )
}

function buildToolPreview(
  toolName: string,
  params: Record<string, unknown>,
): ToolPreview {
  const str = (v: unknown): string =>
    typeof v === 'string' ? v : JSON.stringify(v ?? '')

  switch (toolName) {
    case 'gmail': {
      const body = str(params['body'] ?? params['text'] ?? '')
      const bodyPreview = body.split('\n').slice(0, 3).join('\n')
      return {
        type: 'email',
        fields: {
          Empfänger: str(params['to'] ?? params['recipient'] ?? ''),
          Betreff: str(params['subject'] ?? ''),
          Nachricht: bodyPreview,
        },
      }
    }
    case 'calendar':
      return {
        type: 'calendar',
        fields: {
          Titel: str(params['title'] ?? params['summary'] ?? ''),
          Datum: str(params['date'] ?? params['startDate'] ?? ''),
          Uhrzeit: str(params['time'] ?? params['startTime'] ?? ''),
          Teilnehmer: str(params['attendees'] ?? ''),
        },
      }
    case 'shell':
      return {
        type: 'shell',
        fields: {
          Befehl: str(params['command'] ?? ''),
          Argumente: str(params['args'] ?? ''),
        },
        warning: 'Shell-Befehle können das System verändern. Bitte prüfe den Befehl sorgfältig.',
      }
    case 'filesystem':
      return {
        type: 'filesystem',
        fields: {
          Pfad: str(params['path'] ?? ''),
          Aktion: str(params['action'] ?? params['operation'] ?? ''),
        },
      }
    case 'notes':
      return {
        type: 'notes',
        fields: {
          Titel: str(params['title'] ?? ''),
        },
      }
    case 'connect-google':
      return {
        type: 'oauth_connect' as ToolPreviewType,
        fields: {
          Provider: 'Google',
          Dienste: 'Gmail, Kalender',
        },
      }
    default: {
      const fields: Record<string, string> = Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, str(value)]),
      )
      return { type: 'generic', fields }
    }
  }
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

    window.api.gatewayFetch({ method: 'GET', path: `/api/sessions/${encodeURIComponent(activeSessionId)}/messages` })
      .then((res) => {
        if (!res.ok) throw new Error(`Status ${res.status.toString()}`)
        const data: unknown = res.data
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

      // Generate a session UUID client-side for new chats (gateway requires a valid UUID)
      const isNewSession = currentSessionIdRef.current === null
      const sessionId = currentSessionIdRef.current ?? crypto.randomUUID()
      if (isNewSession) {
        currentSessionIdRef.current = sessionId
      }

      // Build request — multipart/form-data when files attached, JSON otherwise
      let postPromise: Promise<unknown>
      if (files !== undefined && files.length > 0) {
        // Security: file upload uses direct fetch which cannot carry auth tokens.
        // In server mode the remote gateway requires Authorization headers,
        // so file uploads are blocked until an IPC-based multipart proxy exists.
        if (getGatewayMode() === 'server') {
          setIsLoading(false)
          setError('Datei-Upload ist im Server-Modus noch nicht verfügbar')
          return
        }

        // File upload: direct fetch to gateway URL (local mode only)
        const formData = new FormData()
        formData.append('text', trimmed)
        if (sessionId !== null) {
          formData.append('sessionId', sessionId)
        }
        for (const file of files) {
          formData.append('files', file)
        }
        postPromise = fetch(`${getGatewayUrl()}/api/message`, {
          method: 'POST',
          body: formData,
        }).then((res) => {
          if (!res.ok) throw new Error(`Gateway antwortet mit Status ${res.status.toString()}`)
          return res.json() as Promise<unknown>
        })
      } else {
        postPromise = window.api
          .gatewayFetch({ method: 'POST', path: '/api/message', body: { text: trimmed, sessionId } })
          .then((res) => {
            if (!res.ok) {
              const detail = typeof res.data === 'object' && res.data !== null
                ? ((res.data as Record<string, unknown>)['error'] as string) ?? ''
                : ''
              throw new Error(`Gateway-Fehler ${res.status.toString()}${detail ? ': ' + detail : ''}`)
            }
            return res.data
          })
      }

      // POST to gateway
      postPromise
        .then((data) => {
          if (!isMessageResponse(data)) {
            throw new Error('Ungültige Antwort vom Gateway')
          }

          // Track new session
          if (isNewSession) {
            onSessionCreated?.(sessionId)
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

          // Open SSE stream — URL with token is constructed by main process
          return window.api.getStreamUrl(data.sessionId).then((streamUrl) => {
            const es = new EventSource(streamUrl)
            eventSourceRef.current = es
            return es
          })
        })
        .then((es) => {
          if (!es) return

          es.addEventListener('token', (e: MessageEvent<string>) => {
            // Gateway sends accumulated text (snapshot per turn), not deltas
            assistantBufferRef.current = e.data
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

          es.addEventListener('tool_confirm', (e: MessageEvent<string>) => {
            try {
              const parsed: unknown = JSON.parse(e.data)
              if (!isToolConfirmPayload(parsed)) return
              const preview = buildToolPreview(parsed.toolName, parsed.params)
              const confirmMsg: ChatMessage = {
                id: `confirm-${Date.now().toString(36)}`,
                role: 'assistant',
                content: '',
                toolName: parsed.toolName,
                toolParams: parsed.params,
                toolCallId: parsed.toolCallId,
                toolConfirmPending: true,
                toolConfirmPreview: preview,
                toolStartedAt: Date.now(),
              }
              setMessages((prev) => [...prev, confirmMsg])
            } catch {
              // invalid payload — ignore
            }
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
              const target = prev.at(actualIdx)
              if (!target) return prev
              return prev.map((m, i) =>
                i === actualIdx
                  ? { ...m, toolResult: result, toolFinishedAt: Date.now() }
                  : m,
              )
            })
          })

          es.addEventListener('done', (e: MessageEvent<string>) => {
            // Apply final text from gateway to ensure completeness
            try {
              const parsed: unknown = JSON.parse(e.data)
              if (
                typeof parsed === 'object' &&
                parsed !== null &&
                'text' in parsed &&
                typeof (parsed as { text: string }).text === 'string'
              ) {
                const finalText = (parsed as { text: string }).text
                if (finalText.length > 0) {
                  const currentId = assistantIdRef.current
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === currentId ? { ...m, content: finalText } : m,
                    ),
                  )
                }
              }
            } catch {
              // done event may not carry text — that's ok
            }
            es.close()
            eventSourceRef.current = null
            setIsLoading(false)
          })

          es.addEventListener('token_refreshed', (e: MessageEvent<string>) => {
            try {
              const data = JSON.parse(e.data) as { provider: string; accessToken: string; expiresAt: number }
              void window.api.updateOAuthToken(data)
            } catch {
              // invalid payload — ignore
            }
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

  const confirmTool = useCallback(
    (
      toolCallId: string,
      decision: 'execute' | 'reject',
      modifiedParams?: Record<string, unknown>,
      oauthTokens?: OAuthTokens,
    ) => {
      const sessionId = currentSessionIdRef.current
      if (sessionId === null) return

      const body: Record<string, unknown> = { toolCallId, decision }
      if (modifiedParams !== undefined) {
        body['modifiedParams'] = modifiedParams
      }
      if (oauthTokens !== undefined) {
        body['oauthTokens'] = oauthTokens
      }

      window.api.gatewayFetch({
        method: 'POST',
        path: `/api/confirm/${encodeURIComponent(sessionId)}`,
        body,
      }).catch(() => {
        // Confirmation delivery failed — ignore silently
      })

      setMessages((prev) =>
        prev.map((m) =>
          m.toolCallId === toolCallId
            ? {
                ...m,
                toolConfirmPending: false,
                ...(decision === 'reject'
                  ? {
                      toolResult: { rejected: true, reason: 'User hat abgelehnt' },
                      toolFinishedAt: Date.now(),
                    }
                  : {}),
              }
            : m,
        ),
      )
    },
    [],
  )

  return { messages, isLoading, error, sendMessage, confirmTool }
}

export type { ChatMessage, UseChatReturn, UseChatOptions }
