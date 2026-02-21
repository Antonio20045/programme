import { useState, useEffect } from 'react'
import { useGatewayConfig } from './useGatewayConfig'

/** Shared hook for agent connection status. Eliminates duplication between Sidebar and Chat. */
export function useAgentStatus(): string {
  const { mode } = useGatewayConfig()
  const [agentStatus, setAgentStatus] = useState<string>('local')

  useEffect(() => {
    if (mode !== 'server') return
    void window.api.agentStatus().then((s) => {
      setAgentStatus(typeof s === 'string' ? s : 'local')
    })
    const unsubscribe = window.api.onAgentStatus((s) => {
      setAgentStatus(typeof s === 'string' ? s : 'local')
    })
    return unsubscribe
  }, [mode])

  return agentStatus
}
