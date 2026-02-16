import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useGatewayStatus } from '../hooks/useGatewayStatus'
import SessionList from './SessionList'
import type { Session } from '../hooks/useSessions'

const STATUS_LABELS: Record<GatewayStatus, string> = {
  starting: 'Gateway startet...',
  online: 'Gateway online',
  offline: 'Gateway offline',
  error: 'Gateway Fehler',
}

const STATUS_COLORS: Record<GatewayStatus, string> = {
  starting: 'bg-amber-500',
  online: 'bg-emerald-500',
  offline: 'bg-gray-500',
  error: 'bg-red-500',
}

interface SidebarProps {
  readonly sessions: readonly Session[]
  readonly activeSessionId: string | null
  readonly onSelectSession: (id: string) => void
  readonly onCreateSession: () => void
  readonly onDeleteSession: (id: string) => void
}

export default function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}: SidebarProps): JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const status = useGatewayStatus()

  const handleSelectSession = useCallback(
    (id: string) => {
      onSelectSession(id)
      if (location.pathname !== '/chat') {
        void navigate('/chat')
      }
    },
    [onSelectSession, location.pathname, navigate],
  )

  const handleCreateSession = useCallback(() => {
    onCreateSession()
    if (location.pathname !== '/chat') {
      void navigate('/chat')
    }
  }, [onCreateSession, location.pathname, navigate])

  return (
    <aside className="flex h-full w-[200px] flex-col bg-gray-900 text-gray-100">
      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-2">
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelectSession}
          onCreate={handleCreateSession}
          onDelete={onDeleteSession}
        />
      </div>

      {/* Settings nav */}
      <div className="border-t border-gray-800 p-2">
        <button
          type="button"
          onClick={() => {
            void navigate('/settings')
          }}
          className={`w-full rounded px-3 py-2 text-left text-sm transition-colors ${
            location.pathname === '/settings'
              ? 'bg-gray-700 text-white'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
          }`}
        >
          Einstellungen
        </button>
      </div>

      {/* Gateway status */}
      <div className="border-t border-gray-800 p-3">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_COLORS[status]}`}
          />
          <span className="text-gray-400">{STATUS_LABELS[status]}</span>
        </div>
      </div>
    </aside>
  )
}

export type { SidebarProps }
