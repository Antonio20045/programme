import React from 'react'
import { Text } from 'react-native'
import { renderHook } from '@testing-library/react-native'

// Mock Clerk
jest.mock('@clerk/clerk-expo', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    isSignedIn: true,
    isLoaded: true,
    getToken: jest.fn().mockResolvedValue('mock-token'),
  }),
}))

jest.mock('@clerk/clerk-expo/token-cache', () => ({
  tokenCache: {},
}))

jest.mock('expo-constants', () => ({
  expoConfig: { extra: {} },
}))

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('exports AuthProvider and useAuthContext', () => {
    const mod = require('../contexts/AuthContext')
    expect(typeof mod.AuthProvider).toBe('function')
    expect(typeof mod.useAuthContext).toBe('function')
  })

  it('provides passthrough when EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not set', () => {
    const { AuthProvider, useAuthContext } = require('../contexts/AuthContext')

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    )

    const { result } = renderHook(() => useAuthContext(), { wrapper })

    expect(result.current.clerkEnabled).toBe(false)
    expect(result.current.isSignedIn).toBe(true)
    expect(result.current.isLoaded).toBe(true)
  })

  it('getToken returns null in passthrough mode', async () => {
    const { AuthProvider, useAuthContext } = require('../contexts/AuthContext')

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    )

    const { result } = renderHook(() => useAuthContext(), { wrapper })

    const token = await result.current.getToken()
    expect(token).toBeNull()
  })
})
