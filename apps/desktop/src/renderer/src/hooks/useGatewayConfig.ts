import { useState, useEffect } from 'react'
import { resolveGatewayConfig, updateCachedConfig } from '../config'

interface GatewayConfigState {
  readonly mode: 'local' | 'server'
  readonly serverUrl: string
  readonly tokenLast4: string
  readonly loading: boolean
}

function isGatewayConfig(value: unknown): value is { mode: string; serverUrl: string; token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mode' in value &&
    'serverUrl' in value &&
    'token' in value
  )
}

export function useGatewayConfig(): GatewayConfigState {
  const [state, setState] = useState<GatewayConfigState>({
    mode: 'local',
    serverUrl: '',
    tokenLast4: '',
    loading: true,
  })

  useEffect(() => {
    void resolveGatewayConfig().then((cfg) => {
      setState({
        mode: cfg.mode,
        serverUrl: cfg.url,
        tokenLast4: cfg.token,
        loading: false,
      })
    })

    const unsubscribe = window.api.onGatewayConfigChanged((config: unknown) => {
      if (!isGatewayConfig(config)) return
      const mode = config.mode === 'server' ? ('server' as const) : ('local' as const)
      const url = typeof config.serverUrl === 'string' ? config.serverUrl : ''
      const tokenLast4 = typeof config.token === 'string' ? config.token : ''

      updateCachedConfig(mode, url)
      setState({ mode, serverUrl: url, tokenLast4, loading: false })
    })

    return unsubscribe
  }, [])

  return state
}

export type { GatewayConfigState }
