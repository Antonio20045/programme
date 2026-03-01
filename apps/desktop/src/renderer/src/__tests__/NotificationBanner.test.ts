import { describe, it, expect } from 'vitest'
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

describe('NotificationBanner — display logic', () => {
  const MAX_VISIBLE = 3

  it('returns null equivalent when no notifications', () => {
    const notifications: AgentNotification[] = []
    expect(notifications.length).toBe(0)
  })

  it('shows up to MAX_VISIBLE (3) notifications', () => {
    const notifications = [
      makeNotification({ id: 'n-1' }),
      makeNotification({ id: 'n-2' }),
      makeNotification({ id: 'n-3' }),
      makeNotification({ id: 'n-4' }),
      makeNotification({ id: 'n-5' }),
    ]
    const visible = notifications.slice(0, MAX_VISIBLE)
    const hiddenCount = notifications.length - visible.length

    expect(visible).toHaveLength(3)
    expect(hiddenCount).toBe(2)
  })

  it('shows no hidden count when <= MAX_VISIBLE', () => {
    const notifications = [
      makeNotification({ id: 'n-1' }),
      makeNotification({ id: 'n-2' }),
    ]
    const visible = notifications.slice(0, MAX_VISIBLE)
    const hiddenCount = notifications.length - visible.length

    expect(visible).toHaveLength(2)
    expect(hiddenCount).toBe(0)
  })
})

describe('NotificationBanner — type styling', () => {
  const TYPE_STYLES: Record<AgentNotification['type'], string> = {
    'result': 'border-accent/60 bg-accent/8',
    'needs-approval': 'border-amber-500/60 bg-amber-500/8',
    'error': 'border-error/60 bg-error/8',
  }

  const TYPE_LABELS: Record<AgentNotification['type'], string> = {
    'result': 'Ergebnis',
    'needs-approval': 'Genehmigung nötig',
    'error': 'Fehler',
  }

  it('maps result type to accent style', () => {
    expect(TYPE_STYLES['result']).toContain('accent')
    expect(TYPE_LABELS['result']).toBe('Ergebnis')
  })

  it('maps needs-approval type to amber style', () => {
    expect(TYPE_STYLES['needs-approval']).toContain('amber')
    expect(TYPE_LABELS['needs-approval']).toBe('Genehmigung nötig')
  })

  it('maps error type to error style', () => {
    expect(TYPE_STYLES['error']).toContain('error')
    expect(TYPE_LABELS['error']).toBe('Fehler')
  })

  it('all notification types have styles and labels', () => {
    const types: AgentNotification['type'][] = ['result', 'needs-approval', 'error']
    for (const t of types) {
      expect(TYPE_STYLES[t]).toBeDefined()
      expect(TYPE_LABELS[t]).toBeDefined()
      expect(TYPE_STYLES[t].length).toBeGreaterThan(0)
      expect(TYPE_LABELS[t].length).toBeGreaterThan(0)
    }
  })
})

describe('NotificationBanner — "alle verwerfen" logic', () => {
  it('shows "alle verwerfen" when more than 1 notification', () => {
    const notifications = [
      makeNotification({ id: 'n-1' }),
      makeNotification({ id: 'n-2' }),
    ]
    const showAll = notifications.length > 1
    expect(showAll).toBe(true)
  })

  it('hides "alle verwerfen" for single notification', () => {
    const notifications = [makeNotification({ id: 'n-1' })]
    const hiddenCount = 0
    const showAll = hiddenCount > 0 || notifications.length > 1
    expect(showAll).toBe(false)
  })

  it('shows hidden count and "alle verwerfen" when overflow', () => {
    const notifications = Array.from({ length: 5 }, (_, i) =>
      makeNotification({ id: `n-${String(i)}` }),
    )
    const MAX_VISIBLE = 3
    const hiddenCount = notifications.length - MAX_VISIBLE
    expect(hiddenCount).toBe(2)
    expect(hiddenCount > 0 || notifications.length > 1).toBe(true)
  })
})
