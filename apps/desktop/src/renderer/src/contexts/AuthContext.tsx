import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ClerkProvider, useAuth } from '@clerk/clerk-react'

interface AuthContextValue {
  isSignedIn: boolean
  isLoaded: boolean
  clerkEnabled: boolean
}

const AuthContext = createContext<AuthContextValue>({
  isSignedIn: true,
  isLoaded: true,
  clerkEnabled: false,
})

export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext)
}

const TOKEN_SYNC_INTERVAL_MS = 50_000

/**
 * Inner component that syncs the Clerk JWT to the main process
 * via IPC so gateway:fetch can inject it as X-Clerk-Token header.
 */
function ClerkAuthSync({ children }: { children: React.ReactNode }): JSX.Element {
  const { isSignedIn, isLoaded, getToken } = useAuth()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const syncToken = useCallback(async () => {
    try {
      const token = await getToken()
      await window.api.setClerkToken(token)
    } catch {
      // Token fetch failed — clear cached token
      await window.api.setClerkToken(null)
    }
  }, [getToken])

  useEffect(() => {
    if (!isLoaded) return

    if (isSignedIn) {
      void syncToken()
      intervalRef.current = setInterval(() => void syncToken(), TOKEN_SYNC_INTERVAL_MS)
    } else {
      void window.api.setClerkToken(null)
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isSignedIn, isLoaded, syncToken])

  const value: AuthContextValue = {
    isSignedIn: isSignedIn ?? false,
    isLoaded,
    clerkEnabled: true,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [publishableKey, setPublishableKey] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    window.api.getClerkPublishableKey().then(setPublishableKey)
  }, [])

  // Still loading the key
  if (publishableKey === undefined) {
    return (
      <AuthContext.Provider value={{ isSignedIn: false, isLoaded: false, clerkEnabled: false }}>
        {children}
      </AuthContext.Provider>
    )
  }

  // No Clerk key configured — passthrough (local mode without Clerk)
  if (publishableKey === null) {
    return (
      <AuthContext.Provider value={{ isSignedIn: true, isLoaded: true, clerkEnabled: false }}>
        {children}
      </AuthContext.Provider>
    )
  }

  // Clerk is configured
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkAuthSync>{children}</ClerkAuthSync>
    </ClerkProvider>
  )
}
