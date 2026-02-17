import { describe, it, expect, vi } from 'vitest'

// Mock CSS import
vi.mock('../src/App.css', () => ({}))

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  Routes: vi.fn(),
  Route: vi.fn(),
  Navigate: vi.fn(),
  useLocation: () => ({ pathname: '/chat' }),
  useNavigate: () => vi.fn(),
}))

// Mock window.api
vi.stubGlobal('window', {
  api: {
    getGatewayStatus: vi.fn<[], Promise<string>>().mockResolvedValue('online'),
    onGatewayStatus: vi.fn<[(status: string) => void], () => void>().mockReturnValue(vi.fn()),
    getSetupRequired: vi.fn<[], Promise<boolean>>().mockResolvedValue(false),
  },
})

// Mock React hooks
vi.mock('react', () => ({
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
}))

import App from '../src/App'

describe('App', () => {
  it('is a function component', () => {
    expect(typeof App).toBe('function')
  })
})
