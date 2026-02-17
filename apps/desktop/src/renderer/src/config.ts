const LOCAL_GATEWAY_URL = 'http://127.0.0.1:18789'

// Module-level cache (synchronous access for URL/mode)
let cachedUrl: string = LOCAL_GATEWAY_URL
let cachedMode: 'local' | 'server' = 'local'

/**
 * Resolve gateway config from main process.
 * Call once at app init (in useGatewayConfig hook).
 */
export async function resolveGatewayConfig(): Promise<{
  mode: 'local' | 'server'
  url: string
  token: string
}> {
  try {
    const config = await window.api.getGatewayConfig()
    const mode = config.mode === 'server' ? ('server' as const) : ('local' as const)
    if (mode === 'server' && config.serverUrl !== '') {
      cachedUrl = config.serverUrl
      cachedMode = 'server'
    } else {
      cachedUrl = LOCAL_GATEWAY_URL
      cachedMode = 'local'
    }

    return { mode: cachedMode, url: cachedUrl, token: config.token }
  } catch {
    cachedUrl = LOCAL_GATEWAY_URL
    cachedMode = 'local'
    return { mode: 'local', url: LOCAL_GATEWAY_URL, token: '' }
  }
}

/** Update the cached config (called when mode changes via IPC). */
export function updateCachedConfig(mode: 'local' | 'server', url: string): void {
  cachedMode = mode
  cachedUrl = mode === 'server' ? url : LOCAL_GATEWAY_URL
}

/** Synchronous getter — returns cached URL. */
export function getGatewayUrl(): string {
  return cachedUrl
}

/** Synchronous getter — returns 'local' | 'server'. */
export function getGatewayMode(): 'local' | 'server' {
  return cachedMode
}

// Backward-compatible export (not used by useChat/useSessions anymore)
export const GATEWAY_URL = LOCAL_GATEWAY_URL
