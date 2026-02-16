import { useState, useEffect } from 'react'

const VALID_STATUSES: ReadonlySet<string> = new Set<GatewayStatus>([
  'starting',
  'online',
  'offline',
  'error',
])

function isGatewayStatus(value: unknown): value is GatewayStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value)
}

export function useGatewayStatus(): GatewayStatus {
  const [status, setStatus] = useState<GatewayStatus>('starting')

  useEffect(() => {
    window.api
      .getGatewayStatus()
      .then((s) => {
        if (isGatewayStatus(s)) {
          setStatus(s)
        }
      })
      .catch(() => setStatus('offline'))

    const unsubscribe = window.api.onGatewayStatus((s) => {
      if (isGatewayStatus(s)) {
        setStatus(s)
      }
    })

    return unsubscribe
  }, [])

  return status
}
