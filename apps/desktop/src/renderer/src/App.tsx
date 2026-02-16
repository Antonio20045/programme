import './App.css'
import { useCallback } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useSessions } from './hooks/useSessions'
import Sidebar from './components/Sidebar'
import Chat from './pages/Chat'
import Settings from './pages/Settings'

export default function App(): JSX.Element {
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
