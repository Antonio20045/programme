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
})
