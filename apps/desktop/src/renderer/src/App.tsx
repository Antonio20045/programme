import './App.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuthContext } from './contexts/AuthContext'
import { GatewayStatusProvider } from './contexts/GatewayStatusContext'
import { useSessions } from './hooks/useSessions'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import ErrorBoundary from './components/ErrorBoundary'
import Sidebar from './components/Sidebar'
import CommandPalette from './components/CommandPalette'
import Chat from './pages/Chat'
import Settings from './pages/Settings'
import Setup from './pages/Setup'
import AuthScreen from './pages/AuthScreen'
import type { CommandItem } from './components/CommandPalette'

function AppContent(): JSX.Element {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [setupDone, setSetupDone] = useState(false)
  const [authSkipped, setAuthSkipped] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { isSignedIn, isLoaded, clerkEnabled } = useAuthContext()
  const navigate = useNavigate()

  useEffect(() => {
    window.api.getSetupRequired().then(setSetupRequired)
  }, [])

  const {
    sessions,
    activeSessionId,
    selectSession,
    createSession,
    deleteSession,
    refreshSessions,
  } = useSessions()

  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      selectSession(sessionId)
      refreshSessions()
    },
    [selectSession, refreshSessions],
  )

  // Command palette commands
  const commands = useMemo((): readonly CommandItem[] => [
    {
      id: 'new-chat',
      label: 'Neuer Chat',
      category: 'Navigation',
      icon: '\u{2795}',
      shortcut: '\u2318N',
      action: () => {
        createSession()
        void navigate('/chat')
      },
    },
    {
      id: 'settings',
      label: 'Einstellungen',
      category: 'Navigation',
      icon: '\u{2699}\uFE0F',
      shortcut: '\u2318,',
      action: () => { void navigate('/settings') },
    },
    {
      id: 'chat',
      label: 'Zum Chat',
      category: 'Navigation',
      icon: '\u{1F4AC}',
      action: () => { void navigate('/chat') },
    },
  ], [createSession, navigate])

  // Global keyboard shortcuts
  const shortcuts = useMemo(() => [
    { key: 'k', meta: true, handler: () => { setPaletteOpen(true) } },
    { key: 'n', meta: true, handler: () => { createSession(); void navigate('/chat') } },
    { key: ',', meta: true, handler: () => { void navigate('/settings') } },
  ], [createSession, navigate])

  useKeyboardShortcuts(shortcuts)

  // Loading state while checking first-run status or Clerk auth
  if (setupRequired === null || !isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <p className="text-content-secondary">Lade...</p>
      </div>
    )
  }

  // First run — full-screen setup wizard (no sidebar)
  if (setupRequired && !setupDone) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup onSetupComplete={() => setSetupDone(true)} />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  // Auth gate — show sign-in when Clerk is enabled and user is not signed in
  if (clerkEnabled && !isSignedIn && !authSkipped) {
    return <AuthScreen onSkip={() => setAuthSkipped(true)} />
  }

  return (
    <div className="flex h-screen bg-surface text-content">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={selectSession}
        onCreateSession={createSession}
        onDeleteSession={deleteSession}
      />
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route
            path="/chat"
            element={
              <Chat
                activeSessionId={activeSessionId}
                onSessionCreated={handleSessionCreated}
              />
            }
          />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </main>

      {/* Command Palette (Cmd+K) */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => { setPaletteOpen(false) }}
        commands={commands}
      />
    </div>
  )
}

export default function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <GatewayStatusProvider>
          <AppContent />
        </GatewayStatusProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
