import { useState, useCallback } from 'react'
import type { Session } from '../hooks/useSessions'

interface SessionListProps {
  readonly sessions: readonly Session[]
  readonly activeSessionId: string | null
  readonly onSelect: (id: string) => void
  readonly onCreate: () => void
  readonly onDelete: (id: string) => void
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays === 1) return 'Gestern'
  if (diffDays < 7) return `vor ${diffDays.toString()} Tagen`
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
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
        className="mb-2 rounded bg-gray-700 px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-600"
      >
        + Neuer Chat
      </button>

      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          onClick={() => { onSelect(session.id) }}
          onContextMenu={(e) => { handleContextMenu(e, session.id) }}
          className={`rounded px-3 py-2 text-left transition-colors ${
            activeSessionId === session.id
              ? 'bg-gray-700 text-white'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
          }`}
        >
          <div className="truncate text-sm">{session.title}</div>
          <div className="text-xs text-gray-500">{formatDate(session.lastMessageAt)}</div>
        </button>
      ))}

      {sessions.length === 0 && (
        <p className="px-3 py-2 text-xs text-gray-500">Keine Chats vorhanden</p>
      )}

      {/* Context menu */}
      {contextMenu !== null && (
        <div
          className="fixed z-50 rounded border border-gray-700 bg-gray-800 py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={handleDeleteClick}
            className="w-full px-4 py-1.5 text-left text-sm text-red-400 hover:bg-gray-700"
          >
            Löschen
          </button>
        </div>
      )}

      {/* Confirm delete dialog */}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg bg-gray-800 p-6 shadow-xl">
            <p className="mb-4 text-sm text-gray-200">Chat wirklich löschen?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelDelete}
                className="rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
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

export type { SessionListProps }
