import { useState, useEffect, useCallback } from 'react'
import type { ChatMessage } from './useChat'

interface Session {
  readonly id: string
  readonly title: string
  readonly lastMessageAt: string
}

interface UseSessionsReturn {
  readonly sessions: readonly Session[]
  readonly activeSessionId: string | null
  readonly isLoading: boolean
  selectSession: (id: string) => void
  createSession: () => void
  deleteSession: (id: string) => void
  refreshSessions: () => void
  readonly messages: readonly ChatMessage[]
}

interface SessionResponse {
  readonly id: string
  readonly lastMessageAt: string
}

interface MessageResponse {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly toolName?: string
  readonly toolResult?: string
}

function isSessionArray(data: unknown): data is SessionResponse[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        typeof (item as SessionResponse).id === 'string' &&
        'lastMessageAt' in item &&
        typeof (item as SessionResponse).lastMessageAt === 'string',
    )
  )
}

function isMessageArray(data: unknown): data is MessageResponse[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        typeof (item as MessageResponse).id === 'string' &&
        'role' in item &&
        'content' in item,
    )
  )
}

function deriveTitle(messages: readonly MessageResponse[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user')
  if (!firstUserMsg) return 'Neuer Chat'
  const text = firstUserMsg.content.trim()
  return text.length > 50 ? `${text.slice(0, 50)}...` : text
}

export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refreshSessions = useCallback(() => {
    setIsLoading(true)
    window.api.gatewayFetch({ method: 'GET', path: '/api/sessions' })
      .then((res) => {
        if (!res.ok) throw new Error(`Status ${res.status.toString()}`)
        const data: unknown = res.data
        if (!isSessionArray(data)) throw new Error('Ungültige Session-Daten')

        // Fetch titles for each session by loading first messages
        const titlePromises = data.map((s) =>
          window.api.gatewayFetch({ method: 'GET', path: `/api/sessions/${encodeURIComponent(s.id)}/messages` })
            .then((r) => {
              if (!r.ok) return [] as MessageResponse[]
              return r.data as unknown
            })
            .then((msgs): Session => {
              const validMsgs = isMessageArray(msgs) ? msgs : []
              return {
                id: s.id,
                title: deriveTitle(validMsgs),
                lastMessageAt: s.lastMessageAt,
              }
            }),
        )

        return Promise.all(titlePromises)
      })
      .then((sessionsWithTitles) => {
        // Sort by lastMessageAt descending (newest first)
        const sorted = [...sessionsWithTitles].sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() -
            new Date(a.lastMessageAt).getTime(),
        )
        setSessions(sorted)
        setIsLoading(false)
      })
      .catch(() => {
        setIsLoading(false)
      })
  }, [])

  // Load sessions on mount
  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id)
    // Load messages for the selected session
    window.api.gatewayFetch({ method: 'GET', path: `/api/sessions/${encodeURIComponent(id)}/messages` })
      .then((res) => {
        if (!res.ok) throw new Error(`Status ${res.status.toString()}`)
        const data: unknown = res.data
        if (!isMessageArray(data)) throw new Error('Ungültige Nachrichten')
        const chatMessages: ChatMessage[] = data.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          ...(m.toolName !== undefined ? { toolName: m.toolName } : {}),
          ...(m.toolResult !== undefined ? { toolResult: m.toolResult } : {}),
        }))
        setMessages(chatMessages)
      })
      .catch(() => {
        setMessages([])
      })
  }, [])

  const createSession = useCallback(() => {
    setActiveSessionId(null)
    setMessages([])
  }, [])

  const deleteSession = useCallback(
    (id: string) => {
      window.api.gatewayFetch({ method: 'DELETE', path: `/api/sessions/${encodeURIComponent(id)}` })
        .then((res) => {
          if (!res.ok) throw new Error(`Status ${res.status.toString()}`)
          setSessions((prev) => prev.filter((s) => s.id !== id))
          if (activeSessionId === id) {
            setActiveSessionId(null)
            setMessages([])
          }
        })
        .catch(() => {
          // Silently fail — session may already be deleted
        })
    },
    [activeSessionId],
  )

  return {
    sessions,
    activeSessionId,
    isLoading,
    selectSession,
    createSession,
    deleteSession,
    refreshSessions,
    messages,
  }
}

export type { Session, UseSessionsReturn }
