import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

const VALID_STATUSES: ReadonlySet<string> = new Set<GatewayStatus>([
  'starting',
  'online',
  'offline',
  'error',
])

function isGatewayStatus(value: unknown): value is GatewayStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value)
}

const GatewayStatusContext = createContext<GatewayStatus>('starting')

export function useGatewayStatus(): GatewayStatus {
  return useContext(GatewayStatusContext)
}

export function GatewayStatusProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<GatewayStatus>('starting')
  const versionRef = useRef(0)

  useEffect(() => {
    // Subscribe to IPC events FIRST so we never miss an update
    const unsubscribe = window.api.onGatewayStatus((s) => {
      if (isGatewayStatus(s)) {
        versionRef.current += 1
        setStatus(s)
      }
    })

    // Then fetch current status — only apply if no IPC event arrived since
    const invokeVersion = versionRef.current
    window.api
      .getGatewayStatus()
      .then((s) => {
        if (isGatewayStatus(s) && versionRef.current === invokeVersion) {
          setStatus(s)
        }
      })
      .catch(() => {
        if (versionRef.current === invokeVersion) {
          setStatus('offline')
        }
      })

    return unsubscribe
  }, [])

  return (
    <GatewayStatusContext.Provider value={status}>
      {children}
    </GatewayStatusContext.Provider>
  )
}
