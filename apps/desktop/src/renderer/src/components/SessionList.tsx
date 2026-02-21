import { useState, useCallback, useMemo } from 'react'
import { formatRelativeDate, getTimeGroup } from '../utils/format-date'
import type { Session } from '../hooks/useSessions'

interface SessionListProps {
  readonly sessions: readonly Session[]
  readonly activeSessionId: string | null
  readonly onSelect: (id: string) => void
  readonly onCreate: () => void
  readonly onDelete: (id: string) => void
}

interface SessionGroup {
  readonly label: string
  readonly sessions: readonly Session[]
}

/** Group sessions by time period (Heute, Gestern, Diese Woche, etc.) */
function groupSessions(sessions: readonly Session[]): readonly SessionGroup[] {
  const groups = new Map<string, Session[]>()
  const order: string[] = []

  for (const session of sessions) {
    const label = getTimeGroup(session.lastMessageAt)
    if (!groups.has(label)) {
      groups.set(label, [])
      order.push(label)
    }
    groups.get(label)!.push(session)
  }

  return order.map((label) => ({
    label,
    sessions: groups.get(label)!,
  }))
}

export default function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onDelete,
}: SessionListProps): JSX.Element {
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const groups = useMemo(() => groupSessions(sessions), [sessions])

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
  }, [])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleDeleteClick = useCallback(() => {
    if (contextMenu) {
      setConfirmDeleteId(contextMenu.id)
      setContextMenu(null)
    }
  }, [contextMenu])

  const handleHoverDelete = useCallback((id: string) => {
    setConfirmDeleteId(id)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    if (confirmDeleteId) {
      onDelete(confirmDeleteId)
      setConfirmDeleteId(null)
    }
  }, [confirmDeleteId, onDelete])

  const handleCancelDelete = useCallback(() => {
    setConfirmDeleteId(null)
  }, [])

  return (
    <div className="flex flex-col gap-1" onClick={handleCloseContextMenu}>
      <button
        type="button"
        onClick={onCreate}
        className="active-press mb-2 flex items-center gap-2 rounded-md bg-surface-hover px-3 py-2 text-left text-sm text-content transition-colors hover:bg-surface-active"
      >
        <svg className="h-4 w-4 text-content-muted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 3v10M3 8h10" strokeLinecap="round" />
        </svg>
        Neuer Chat
      </button>

      {groups.map((group) => (
        <div key={group.label}>
          {/* Group header */}
          <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-content-muted">
            {group.label}
          </div>

          {group.sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => { onSelect(session.id) }}
              onContextMenu={(e) => { handleContextMenu(e, session.id) }}
              className={`group active-press flex w-full items-center rounded-md px-3 py-2 text-left transition-colors ${
                activeSessionId === session.id
                  ? 'bg-surface-active text-content'
                  : 'text-content-secondary hover:bg-surface-hover hover:text-content'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{session.title}</div>
                <div className="text-xs text-content-muted">{formatRelativeDate(session.lastMessageAt)}</div>
              </div>

              {/* Hover delete button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleHoverDelete(session.id)
                }}
                className="ml-2 shrink-0 rounded p-1 text-content-muted opacity-0 transition-opacity hover:bg-error/20 hover:text-error group-hover:opacity-100"
                aria-label="Chat löschen"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
                </svg>
              </button>
            </button>
          ))}
        </div>
      ))}

      {sessions.length === 0 && (
        <p className="px-3 py-2 text-xs text-content-muted">Keine Chats vorhanden</p>
      )}

      {/* Context menu */}
      {contextMenu !== null && (
        <div
          className="fixed z-50 rounded-md border border-edge bg-surface-raised py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={handleDeleteClick}
            className="w-full px-4 py-1.5 text-left text-sm text-error hover:bg-surface-hover"
          >
            Löschen
          </button>
        </div>
      )}

      {/* Confirm delete dialog */}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg bg-surface-raised p-6 shadow-lg">
            <p className="mb-4 text-sm text-content">Chat wirklich löschen?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelDelete}
                className="active-press rounded-md bg-surface-hover px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-active"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="active-press rounded-md bg-error px-3 py-1.5 text-sm text-content hover:bg-error/80"
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { groupSessions }
export type { SessionListProps, SessionGroup }
