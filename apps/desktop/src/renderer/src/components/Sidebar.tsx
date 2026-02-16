import { useLocation, useNavigate } from 'react-router-dom'
import { useGatewayStatus } from '../hooks/useGatewayStatus'

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

interface NavItem {
  readonly path: string
  readonly label: string
}

const NAV_ITEMS: readonly NavItem[] = [
  { path: '/chat', label: 'Chat' },
  { path: '/settings', label: 'Einstellungen' },
]

export default function Sidebar(): JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const status = useGatewayStatus()

  return (
    <aside className="flex h-full w-[200px] flex-col bg-gray-900 text-gray-100">
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.path}
            type="button"
            onClick={() => {
              void navigate(item.path)
            }}
            className={`rounded px-3 py-2 text-left text-sm transition-colors ${
              location.pathname === item.path
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
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
