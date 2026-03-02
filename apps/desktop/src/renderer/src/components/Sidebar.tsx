import { useCallback, useState, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useGatewayStatus } from '../hooks/useGatewayStatus'
import { useGatewayConfig } from '../hooks/useGatewayConfig'
import { useAgentStatus } from '../hooks/useAgentStatus'
import SessionList from './SessionList'
import type { Session } from '../hooks/useSessions'

const STATUS_LABELS = new Map<GatewayStatus, string>([
  ['starting', 'Gateway startet...'],
  ['online', 'Gateway online'],
  ['offline', 'Gateway offline'],
  ['error', 'Gateway Fehler'],
])

const STATUS_COLORS = new Map<GatewayStatus, string>([
  ['starting', 'bg-warning'],
  ['online', 'bg-success'],
  ['offline', 'bg-content-muted'],
  ['error', 'bg-error'],
])

const AGENT_LABELS = new Map<string, string>([
  ['connected', 'Agent verbunden'],
  ['disconnected', 'Agent offline'],
])

const AGENT_COLORS = new Map<string, string>([
  ['connected', 'bg-success'],
  ['disconnected', 'bg-error'],
])

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
  const { mode } = useGatewayConfig()
  const agentStatus = useAgentStatus()
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch] = useState('')

  const filteredSessions = useMemo(() => {
    if (search.trim().length === 0) return sessions
    const q = search.toLowerCase()
    return sessions.filter((s) => s.title.toLowerCase().includes(q))
  }, [sessions, search])

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

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  // Collapsed sidebar — icon-only
  if (collapsed) {
    return (
      <aside className="flex h-full w-sidebar-collapsed flex-col items-center bg-surface-alt py-2 text-content transition-all duration-200">
        {/* Expand button */}
        <button
          type="button"
          onClick={handleToggleCollapse}
          className="active-press mb-3 rounded-md p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
          aria-label="Sidebar öffnen"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* New chat */}
        <button
          type="button"
          onClick={handleCreateSession}
          className="active-press mb-2 rounded-md p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
          aria-label="Neuer Chat"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
        </button>

        {/* Settings */}
        <button
          type="button"
          onClick={() => { void navigate('/settings') }}
          className="active-press mt-auto rounded-md p-2 text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
          aria-label="Einstellungen"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2.5" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4" strokeLinecap="round" />
          </svg>
        </button>

        {/* Status dot */}
        <div className="mt-2 pb-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_COLORS.get(status) ?? 'bg-content-muted'}`}
            title={STATUS_LABELS.get(status) ?? ''}
          />
        </div>
      </aside>
    )
  }

  // Expanded sidebar
  return (
    <aside className="flex h-full w-sidebar flex-col glass text-content transition-all duration-200">
      {/* Header with collapse toggle */}
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-content-muted">Chats</span>
        <button
          type="button"
          onClick={handleToggleCollapse}
          className="active-press rounded-md p-1 text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
          aria-label="Sidebar schließen"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 4L8 8l4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 4L3 8l4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-2 pt-2">
        <div className="relative">
          <svg className="absolute left-2.5 top-2 h-3.5 w-3.5 text-content-muted" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6" cy="6" r="4.5" />
            <path d="M9.5 9.5L13 13" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value) }}
            placeholder="Suche..."
            className="w-full rounded-md bg-surface py-1.5 pl-8 pr-3 text-xs text-content placeholder:text-content-muted focus:outline-none focus:ring-1 focus:ring-edge-focus"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-2">
        <SessionList
          sessions={filteredSessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelectSession}
          onCreate={handleCreateSession}
          onDelete={onDeleteSession}
        />
      </div>

      {/* Settings nav */}
      <div className="border-t border-edge p-2">
        <button
          type="button"
          onClick={() => {
            void navigate('/settings')
          }}
          className={`active-press w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
            location.pathname === '/settings'
              ? 'bg-surface-active text-content'
              : 'text-content-secondary hover:bg-surface-hover hover:text-content'
          }`}
        >
          Einstellungen
        </button>
      </div>

      {/* Gateway status */}
      <div className="border-t border-edge p-3">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_COLORS.get(status) ?? 'bg-content-muted'}`}
          />
          <span className="text-content-secondary">{STATUS_LABELS.get(status) ?? ''}</span>
        </div>
        {mode === 'server' && (
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${AGENT_COLORS.get(agentStatus) ?? 'bg-content-muted'}`}
            />
            <span className="text-content-secondary">{AGENT_LABELS.get(agentStatus) ?? ''}</span>
          </div>
        )}
      </div>
    </aside>
  )
}

export type { SidebarProps }
