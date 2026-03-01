import type { AgentNotification } from '../hooks/useNotifications'

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

const MAX_VISIBLE = 3

export default function NotificationBanner({
  notifications,
  onAcknowledge,
  onAcknowledgeAll,
}: {
  readonly notifications: readonly AgentNotification[]
  readonly onAcknowledge: (id: string) => void
  readonly onAcknowledgeAll: () => void
}): JSX.Element | null {
  if (notifications.length === 0) return null

  const visible = notifications.slice(0, MAX_VISIBLE)
  const hiddenCount = notifications.length - visible.length

  return (
    <div className="flex flex-col gap-2 px-4 pb-2">
      {visible.map((n) => (
        <div
          key={n.id}
          role="status"
          className={`animate-fade-in flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${TYPE_STYLES[n.type]}`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-content">
                {n.agentName}
              </span>
              <span className="text-xs text-content-muted">
                {TYPE_LABELS[n.type]}
              </span>
            </div>
            <p className="mt-0.5 text-content-secondary line-clamp-2">
              {n.summary}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { onAcknowledge(n.id) }}
            className="shrink-0 rounded px-2 py-0.5 text-xs text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
            aria-label="Verwerfen"
          >
            &times;
          </button>
        </div>
      ))}

      {(hiddenCount > 0 || notifications.length > 1) && (
        <div className="flex items-center justify-between px-1">
          {hiddenCount > 0 && (
            <span className="text-xs text-content-muted">
              +{String(hiddenCount)} weitere
            </span>
          )}
          {hiddenCount === 0 && <span />}
          <button
            type="button"
            onClick={onAcknowledgeAll}
            className="text-xs text-content-muted transition-colors hover:text-content"
          >
            Alle verwerfen
          </button>
        </div>
      )}
    </div>
  )
}
