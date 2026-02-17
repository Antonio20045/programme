import './App.css'
import { useCallback, useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useSessions } from './hooks/useSessions'
import Sidebar from './components/Sidebar'
import Chat from './pages/Chat'
import Settings from './pages/Settings'
import Setup from './pages/Setup'

export default function App(): JSX.Element {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)

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

  // Loading state while checking first-run status
  if (setupRequired === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <p className="text-gray-400">Lade...</p>
      </div>
    )
  }

  // First run — full-screen setup wizard (no sidebar)
  if (setupRequired) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
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
    </div>
  )
}
