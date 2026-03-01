import { useState, useEffect, useCallback } from 'react'

export interface AgentNotification {
  readonly id: string
  readonly agentId: string
  readonly agentName: string
  readonly type: 'result' | 'needs-approval' | 'error'
  readonly summary: string
  readonly detail?: string
  readonly priority: 'high' | 'normal' | 'low'
  readonly createdAt: number
  readonly proposalIds?: readonly string[]
}

const MAX_NOTIFICATIONS = 50

export function useNotifications(): {
  notifications: readonly AgentNotification[]
  unreadCount: number
  focusedId: string | null
  acknowledge: (id: string) => void
  acknowledgeAll: () => void
  clearFocus: () => void
} {
  const [notifications, setNotifications] = useState<AgentNotification[]>([])
  const [focusedId, setFocusedId] = useState<string | null>(null)

  useEffect(() => {
    const unsubNotification = window.api.onNotification((notification) => {
      setNotifications((prev) => {
        // Deduplicate by ID
        if (prev.some((n) => n.id === notification.id)) return prev
        const next = [notification as AgentNotification, ...prev]
        return next.slice(0, MAX_NOTIFICATIONS)
      })
    })

    const unsubFocus = window.api.onNotificationFocus((notificationId) => {
      setFocusedId(notificationId)
    })

    return () => {
      unsubNotification()
      unsubFocus()
    }
  }, [])

  const acknowledge = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    void window.api.acknowledgeNotification(id)
  }, [])

  const acknowledgeAll = useCallback(() => {
    for (const n of notifications) {
      void window.api.acknowledgeNotification(n.id)
    }
    setNotifications([])
  }, [notifications])

  const clearFocus = useCallback(() => {
    setFocusedId(null)
  }, [])

  return {
    notifications,
    unreadCount: notifications.length,
    focusedId,
    acknowledge,
    acknowledgeAll,
    clearFocus,
  }
}
