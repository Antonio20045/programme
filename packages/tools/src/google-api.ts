/**
 * Shared Google API client — URL validation, Bearer auth, 401 retry, error mapping.
 * Eliminates ~80 lines of boilerplate per Google Workspace tool.
 *
 * URL policy: HTTPS only, hostname must be in the tool's allowedHosts set.
 * oauth2.googleapis.com is automatically added for token refresh.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoogleApiConfig {
  readonly getAccessToken: () => Promise<string>
  readonly allowedHosts: ReadonlySet<string>
  readonly timeoutMs?: number
}

export interface GoogleApiClient {
  readonly get: (url: string, params?: Record<string, string>) => Promise<unknown>
  readonly post: (url: string, body?: unknown) => Promise<unknown>
  readonly put: (url: string, body?: unknown) => Promise<unknown>
  readonly patch: (url: string, body?: unknown) => Promise<unknown>
  readonly del: (url: string) => Promise<void>
  readonly rawFetch: (url: string, init?: RequestInit) => Promise<Response>
  readonly _resetTokenCache: () => void
}

interface TokenResponse {
  readonly access_token: string
  readonly expires_in: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const OAUTH_HOST = 'oauth2.googleapis.com'

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

export function validateUrl(raw: string, allowedHosts: ReadonlySet<string>): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: ${raw}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Blocked URL scheme "${parsed.protocol}" — only https: is allowed`,
    )
  }

  if (!allowedHosts.has(parsed.hostname) && parsed.hostname !== OAUTH_HOST) {
    throw new Error(
      `Blocked hostname "${parsed.hostname}" — not in the allowed hosts`,
    )
  }

  return parsed
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

function getEnvRequired(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} environment variable is required`)
  }
  return value
}

async function refreshToken(allowedHosts: ReadonlySet<string>, timeoutMs: number): Promise<string> {
  const refreshTokenValue = getEnvRequired('GOOGLE_REFRESH_TOKEN')
  const clientId = getEnvRequired('GOOGLE_CLIENT_ID')
  const clientSecret = getEnvRequired('GOOGLE_CLIENT_SECRET')

  const url = validateUrl(TOKEN_ENDPOINT, allowedHosts)

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshTokenValue,
    grant_type: 'refresh_token',
  })

  const response = await fetch(url.href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(
      `Token refresh failed: ${String(response.status)} ${response.statusText}`,
    )
  }

  const data = (await response.json()) as TokenResponse
  return data.access_token
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function mapApiError(status: number, statusText: string): Error {
  if (status === 403) {
    return new Error(
      'Missing scope — please reconnect the Google integration with the required permissions',
    )
  }
  if (status === 429) {
    return new Error('Rate limit exceeded — please wait a moment and try again')
  }
  return new Error(`Google API error: ${String(status)} ${statusText}`)
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createGoogleApiClient(config: GoogleApiConfig): GoogleApiClient {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let cachedToken: string | undefined

  async function getToken(): Promise<string> {
    if (cachedToken) return cachedToken
    const token = await config.getAccessToken()
    cachedToken = token
    return token
  }

  async function authedFetch(url: string, init: RequestInit): Promise<Response> {
    const validated = validateUrl(url, config.allowedHosts)
    const token = await getToken()

    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)

    const response = await fetch(validated.href, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })

    // 401 → refresh and retry once
    if (response.status === 401) {
      cachedToken = undefined
      const newToken = await refreshToken(config.allowedHosts, timeoutMs)
      cachedToken = newToken
      headers.set('Authorization', `Bearer ${newToken}`)

      const retryResponse = await fetch(validated.href, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!retryResponse.ok) {
        throw mapApiError(retryResponse.status, retryResponse.statusText)
      }
      return retryResponse
    }

    if (!response.ok) {
      throw mapApiError(response.status, response.statusText)
    }

    return response
  }

  async function jsonRequest(method: string, url: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = { method }
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body)
    }
    const response = await authedFetch(url, init)
    return response.json() as Promise<unknown>
  }

  return {
    get: async (url: string, params?: Record<string, string>): Promise<unknown> => {
      let fullUrl = url
      if (params) {
        const searchParams = new URLSearchParams(params)
        fullUrl = `${url}?${searchParams.toString()}`
      }
      return jsonRequest('GET', fullUrl)
    },

    post: async (url: string, body?: unknown): Promise<unknown> => {
      return jsonRequest('POST', url, body)
    },

    put: async (url: string, body?: unknown): Promise<unknown> => {
      return jsonRequest('PUT', url, body)
    },

    patch: async (url: string, body?: unknown): Promise<unknown> => {
      return jsonRequest('PATCH', url, body)
    },

    del: async (url: string): Promise<void> => {
      await authedFetch(url, { method: 'DELETE' })
    },

    rawFetch: async (url: string, init?: RequestInit): Promise<Response> => {
      return authedFetch(url, init ?? { method: 'GET' })
    },

    _resetTokenCache: (): void => {
      cachedToken = undefined
    },
  }
}
