import { useState, useCallback } from 'react'
import { useSignIn } from '@clerk/clerk-react'

interface AuthScreenProps {
  onSkip: () => void
}

export default function AuthScreen({ onSkip }: AuthScreenProps): JSX.Element {
  const { signIn, setActive } = useSignIn()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSignIn = useCallback(async (provider?: string) => {
    setLoading(true)
    setError(null)

    try {
      const result = await window.api.clerkBrowserSignIn(provider)

      if (!result.success || !result.ticket) {
        setError(result.error ?? 'Anmeldung fehlgeschlagen')
        return
      }

      if (!signIn || !setActive) return

      const signInResult = await signIn.create({
        strategy: 'ticket',
        ticket: result.ticket,
      })

      if (signInResult.status === 'complete' && signInResult.createdSessionId) {
        await setActive({ session: signInResult.createdSessionId })
      } else {
        setError('Anmeldung konnte nicht abgeschlossen werden')
      }
    } catch (err: unknown) {
      const clerkErr = err as { errors?: Array<{ message?: string; longMessage?: string }> }
      if (clerkErr.errors?.[0]) {
        setError(clerkErr.errors[0].longMessage ?? clerkErr.errors[0].message ?? 'Fehler')
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Unbekannter Fehler')
      }
    } finally {
      setLoading(false)
    }
  }, [signIn, setActive])

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-surface">
      <div className="w-full max-w-sm animate-fade-in">
        <h1 className="mb-2 text-center text-2xl font-semibold text-content">
          Willkommen
        </h1>
        <p className="mb-8 text-center text-sm text-content-secondary">
          Melde dich an, um fortzufahren
        </p>

        {/* Google sign-in via system browser */}
        <button
          type="button"
          onClick={() => void handleSignIn('google')}
          disabled={loading}
          className="active-press mb-3 flex w-full items-center justify-center gap-3 rounded-lg border border-edge bg-surface-alt px-4 py-3 text-sm font-medium text-content transition-colors hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Mit Google anmelden
        </button>

        {/* General sign-in (opens Clerk sign-in page in browser) */}
        <button
          type="button"
          onClick={() => void handleSignIn()}
          disabled={loading}
          className="active-press mb-6 w-full rounded-lg bg-accent py-3 text-sm font-medium text-surface transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Browser wird geöffnet...' : 'Anmelden'}
        </button>

        {/* Error message */}
        {error !== null && (
          <p className="mb-4 text-center text-sm text-error">
            {error}
          </p>
        )}

        {/* Skip auth */}
        <div className="text-center">
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-content-muted hover:text-content-secondary transition-colors"
          >
            Ohne Account starten
          </button>
        </div>
      </div>
    </div>
  )
}
