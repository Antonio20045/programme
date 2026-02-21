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

// Mock Clerk
vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    isSignedIn: true,
    isLoaded: true,
    getToken: vi.fn().mockResolvedValue('mock-token'),
  }),
  SignIn: () => 'SignIn',
}))

// Mock window.api
vi.stubGlobal('window', {
  api: {
    getGatewayStatus: vi.fn<[], Promise<string>>().mockResolvedValue('online'),
    onGatewayStatus: vi.fn<[(status: string) => void], () => void>().mockReturnValue(vi.fn()),
    getSetupRequired: vi.fn<[], Promise<boolean>>().mockResolvedValue(false),
    getClerkPublishableKey: vi.fn<[], Promise<string | null>>().mockResolvedValue(null),
    setClerkToken: vi.fn().mockResolvedValue({ success: true }),
  },
})

// Mock React hooks
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useState: (initial: unknown) => [initial, vi.fn()],
    useEffect: vi.fn(),
    useCallback: (fn: unknown) => fn,
    useContext: () => ({ isSignedIn: true, isLoaded: true, clerkEnabled: false }),
    createContext: actual.createContext,
  }
})

import type React from 'react'
import App from '../src/App'

describe('App', () => {
  it('is a function component', () => {
    expect(typeof App).toBe('function')
  })
})
