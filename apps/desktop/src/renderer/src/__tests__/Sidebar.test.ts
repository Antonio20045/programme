import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock react-router-dom
const mockNavigate = vi.fn()
const mockLocation = { pathname: '/chat' }

vi.mock('react-router-dom', () => ({
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}))

// Mock window.api
vi.stubGlobal('window', {
  api: {
    getGatewayStatus: vi.fn<[], Promise<string>>().mockResolvedValue('online'),
    onGatewayStatus: vi.fn<[(status: string) => void], () => void>().mockReturnValue(vi.fn()),
  },
})

// Mock React hooks
vi.mock('react', () => ({
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
  useRef: (initial: unknown) => ({ current: initial }),
  useContext: (ctx: { _currentValue: unknown }) => ctx._currentValue,
  createContext: (defaultValue: unknown) => ({ _currentValue: defaultValue, Provider: 'MockProvider' }),
}))

// Mock child components
vi.mock('../components/SessionList', () => ({
  default: () => ({ type: 'mock-session-list' }),
}))

import Sidebar from '../components/Sidebar'

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is a function component', () => {
    expect(typeof Sidebar).toBe('function')
  })

  it('exports a default function named Sidebar', () => {
    expect(Sidebar.name).toBe('Sidebar')
  })

  it('renders expanded by default', () => {
    const result = Sidebar({
      sessions: [],
      activeSessionId: null,
      onSelectSession: vi.fn(),
      onCreateSession: vi.fn(),
      onDeleteSession: vi.fn(),
    })
    const json = JSON.stringify(result)
    // Expanded sidebar has w-sidebar class and search input
    expect(json).toContain('w-sidebar')
    expect(json).toContain('Suche...')
    expect(json).toContain('Chats')
  })

  it('contains settings button', () => {
    const result = Sidebar({
      sessions: [],
      activeSessionId: null,
      onSelectSession: vi.fn(),
      onCreateSession: vi.fn(),
      onDeleteSession: vi.fn(),
    })
    const json = JSON.stringify(result)
    expect(json).toContain('Einstellungen')
  })

  it('contains collapse toggle with aria-label', () => {
    const result = Sidebar({
      sessions: [],
      activeSessionId: null,
      onSelectSession: vi.fn(),
      onCreateSession: vi.fn(),
      onDeleteSession: vi.fn(),
    })
    const json = JSON.stringify(result)
    expect(json).toContain('Sidebar schließen')
  })

  it('contains gateway status area', () => {
    const result = Sidebar({
      sessions: [],
      activeSessionId: null,
      onSelectSession: vi.fn(),
      onCreateSession: vi.fn(),
      onDeleteSession: vi.fn(),
    })
    const json = JSON.stringify(result)
    // Status dot should be present (initial state is 'starting' → bg-warning)
    expect(json).toContain('rounded-full')
    expect(json).toContain('Gateway')
  })
})
