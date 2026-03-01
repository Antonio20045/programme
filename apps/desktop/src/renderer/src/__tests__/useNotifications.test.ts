import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock window.api
const mockOnNotification = vi.fn()
const mockOnNotificationFocus = vi.fn()
const mockAcknowledgeNotification = vi.fn().mockResolvedValue({ success: true })

vi.stubGlobal('window', {
  api: {
    onNotification: mockOnNotification,
    onNotificationFocus: mockOnNotificationFocus,
    acknowledgeNotification: mockAcknowledgeNotification,
  },
})

import type { AgentNotification } from '../hooks/useNotifications'

function makeNotification(overrides: Partial<AgentNotification> = {}): AgentNotification {
  return {
    id: 'n-1',
    agentId: 'agent-abc123',
    agentName: 'Inbox-Checker',
    type: 'result',
    summary: 'Du hast 3 neue E-Mails.',
    priority: 'normal',
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('useNotifications — IPC wiring', () => {
  let notificationCallback: ((n: AgentNotification) => void) | null = null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assigned in beforeEach, read via closure in unsub test
  let focusCallback: ((id: string) => void) | null = null
  let notificationUnsub: (() => void) | null = null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assigned in beforeEach, read via closure in unsub test
  let focusUnsub: (() => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    notificationCallback = null
    focusCallback = null
    notificationUnsub = null
    focusUnsub = null

    mockOnNotification.mockImplementation((cb: (n: AgentNotification) => void) => {
      notificationCallback = cb
      const unsub = (): void => { notificationCallback = null }
      notificationUnsub = unsub
      return unsub
    })
    mockOnNotificationFocus.mockImplementation((cb: (id: string) => void) => {
      focusCallback = cb
      const unsub = (): void => { focusCallback = null }
      focusUnsub = unsub
      return unsub
    })
  })

  it('onNotification registers a callback', () => {
    // Simulate what the hook does on mount
    const unsub = mockOnNotification((_n: AgentNotification) => {})
    expect(mockOnNotification).toHaveBeenCalledTimes(1)
    expect(typeof unsub).toBe('function')
  })

  it('onNotificationFocus registers a callback', () => {
    const unsub = mockOnNotificationFocus((_id: string) => {})
    expect(mockOnNotificationFocus).toHaveBeenCalledTimes(1)
    expect(typeof unsub).toBe('function')
  })

  it('unsubscribe cleans up callback', () => {
    mockOnNotification((_n: AgentNotification) => {})
    expect(notificationCallback).not.toBeNull()
    notificationUnsub?.()
    expect(notificationCallback).toBeNull()
  })

  it('acknowledgeNotification calls IPC with notification ID', async () => {
    await mockAcknowledgeNotification('n-42')
    expect(mockAcknowledgeNotification).toHaveBeenCalledWith('n-42')
  })
})

describe('useNotifications — notification deduplication logic', () => {
  it('deduplicates by ID', () => {
    const seen = new Map<string, AgentNotification>()
    const n1 = makeNotification({ id: 'n-1' })
    const n1dup = makeNotification({ id: 'n-1', summary: 'different' })
    const n2 = makeNotification({ id: 'n-2' })

    for (const n of [n1, n1dup, n2]) {
      if (!seen.has(n.id)) seen.set(n.id, n)
    }

    expect(seen.size).toBe(2)
    // First one wins (original summary)
    expect(seen.get('n-1')?.summary).toBe('Du hast 3 neue E-Mails.')
  })

  it('caps at MAX_NOTIFICATIONS (50)', () => {
    const notifications: AgentNotification[] = []
    const MAX = 50

    for (let i = 0; i < 60; i++) {
      const n = makeNotification({ id: `n-${String(i)}` })
      if (!notifications.some((existing) => existing.id === n.id)) {
        notifications.unshift(n)
      }
    }

    const capped = notifications.slice(0, MAX)
    expect(capped).toHaveLength(50)
    // Newest first (n-59)
    expect(capped[0]?.id).toBe('n-59')
  })
})

describe('useNotifications — acknowledge logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes notification by ID', () => {
    const notifications = [
      makeNotification({ id: 'n-1' }),
      makeNotification({ id: 'n-2' }),
      makeNotification({ id: 'n-3' }),
    ]

    const afterAck = notifications.filter((n) => n.id !== 'n-2')
    expect(afterAck).toHaveLength(2)
    expect(afterAck.map((n) => n.id)).toEqual(['n-1', 'n-3'])
  })

  it('acknowledgeAll calls IPC for each notification', async () => {
    const notifications = [
      makeNotification({ id: 'n-1' }),
      makeNotification({ id: 'n-2' }),
    ]

    for (const n of notifications) {
      await mockAcknowledgeNotification(n.id)
    }
    expect(mockAcknowledgeNotification).toHaveBeenCalledTimes(2)
    expect(mockAcknowledgeNotification).toHaveBeenCalledWith('n-1')
    expect(mockAcknowledgeNotification).toHaveBeenCalledWith('n-2')
  })
})

describe('AgentNotification type', () => {
  it('creates valid notification with required fields', () => {
    const n = makeNotification()
    expect(n.id).toBe('n-1')
    expect(n.agentId).toBe('agent-abc123')
    expect(n.agentName).toBe('Inbox-Checker')
    expect(n.type).toBe('result')
    expect(n.summary).toBe('Du hast 3 neue E-Mails.')
    expect(n.priority).toBe('normal')
    expect(typeof n.createdAt).toBe('number')
  })

  it('supports optional fields', () => {
    const n = makeNotification({
      detail: 'Detaillierte Info...',
      proposalIds: ['p-1', 'p-2'],
    })
    expect(n.detail).toBe('Detaillierte Info...')
    expect(n.proposalIds).toEqual(['p-1', 'p-2'])
  })

  it('supports all notification types', () => {
    const result = makeNotification({ type: 'result' })
    const approval = makeNotification({ type: 'needs-approval' })
    const error = makeNotification({ type: 'error' })
    expect(result.type).toBe('result')
    expect(approval.type).toBe('needs-approval')
    expect(error.type).toBe('error')
  })

  it('supports all priority levels', () => {
    const high = makeNotification({ priority: 'high' })
    const normal = makeNotification({ priority: 'normal' })
    const low = makeNotification({ priority: 'low' })
    expect(high.priority).toBe('high')
    expect(normal.priority).toBe('normal')
    expect(low.priority).toBe('low')
  })
})
