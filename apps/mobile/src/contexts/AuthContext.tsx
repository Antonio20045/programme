import React, { createContext, useCallback, useContext } from 'react'
import { ClerkProvider, useAuth } from '@clerk/clerk-expo'
import { tokenCache } from '@clerk/clerk-expo/token-cache'
import Constants from 'expo-constants'

interface AuthContextValue {
  isSignedIn: boolean
  isLoaded: boolean
  clerkEnabled: boolean
  getToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextValue>({
  isSignedIn: true,
  isLoaded: true,
  clerkEnabled: false,
  getToken: async () => null,
})

export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext)
}

function ClerkAuthBridge({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { isSignedIn, isLoaded, getToken } = useAuth()

  const wrappedGetToken = useCallback(async (): Promise<string | null> => {
    try {
      return await getToken()
    } catch {
      return null
    }
  }, [getToken])

  const value: AuthContextValue = {
    isSignedIn: isSignedIn ?? false,
    isLoaded,
    clerkEnabled: true,
    getToken: wrappedGetToken,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

const CLERK_KEY = Constants.expoConfig?.extra?.['CLERK_PUBLISHABLE_KEY'] as string | undefined
  ?? process.env['EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY']
  ?? ''

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  if (!CLERK_KEY) {
    return (
      <AuthContext.Provider
        value={{ isSignedIn: true, isLoaded: true, clerkEnabled: false, getToken: async () => null }}
      >
        {children}
      </AuthContext.Provider>
    )
  }

  return (
    <ClerkProvider publishableKey={CLERK_KEY} tokenCache={tokenCache}>
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  )
}
