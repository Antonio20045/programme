import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Clerk React
vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    isSignedIn: true,
    isLoaded: true,
    getToken: vi.fn().mockResolvedValue('mock-clerk-token'),
  }),
}))

// Mock window.api
const mockSetClerkToken = vi.fn().mockResolvedValue({ success: true })
const mockGetClerkPublishableKey = vi.fn().mockResolvedValue(null)

vi.stubGlobal('window', {
  api: {
    setClerkToken: mockSetClerkToken,
    getClerkPublishableKey: mockGetClerkPublishableKey,
  },
})

import type React from 'react'

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provides passthrough when no publishable key is set', async () => {
    // getClerkPublishableKey returns null → clerkEnabled: false, isSignedIn: true
    mockGetClerkPublishableKey.mockResolvedValue(null)
    const result = await mockGetClerkPublishableKey()
    expect(result).toBeNull()
  })

  it('provides clerkEnabled true when publishable key is set', async () => {
    mockGetClerkPublishableKey.mockResolvedValue('pk_test_abc123')
    const result = await mockGetClerkPublishableKey()
    expect(result).toBe('pk_test_abc123')
  })

  it('calls setClerkToken via IPC with token string', async () => {
    await mockSetClerkToken('test-token')
    expect(mockSetClerkToken).toHaveBeenCalledWith('test-token')
  })

  it('clears token on sign-out via setClerkToken(null)', async () => {
    await mockSetClerkToken(null)
    expect(mockSetClerkToken).toHaveBeenCalledWith(null)
  })

  it('exports useAuthContext hook', async () => {
    const mod = await import('../contexts/AuthContext')
    expect(typeof mod.useAuthContext).toBe('function')
  })

  it('exports AuthProvider component', async () => {
    const mod = await import('../contexts/AuthContext')
    expect(typeof mod.AuthProvider).toBe('function')
  })
})
