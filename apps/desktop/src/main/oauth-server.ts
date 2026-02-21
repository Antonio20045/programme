/* eslint-disable security/detect-non-literal-fs-filename */
/* eslint-disable security/detect-object-injection */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { net, safeStorage } from 'electron'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OAUTH_PORT = 18790
const REDIRECT_URI = `http://127.0.0.1:${String(OAUTH_PORT)}/callback`
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

const SERVICE_SCOPES: Record<string, string> = {
  gmail: 'https://www.googleapis.com/auth/gmail.modify',
  calendar: 'https://www.googleapis.com/auth/calendar',
  drive: 'https://www.googleapis.com/auth/drive.file',
  docs: 'https://www.googleapis.com/auth/documents',
  sheets: 'https://www.googleapis.com/auth/spreadsheets',
  contacts: 'https://www.googleapis.com/auth/contacts.readonly',
  tasks: 'https://www.googleapis.com/auth/tasks',
  youtube: 'https://www.googleapis.com/auth/youtube',
}

const VALID_SERVICES = ['gmail', 'calendar', 'drive', 'docs', 'sheets', 'contacts', 'tasks', 'youtube'] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenData {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
  obtained_at: number
}

// ---------------------------------------------------------------------------
// OAuthServer — temporary HTTP server for OAuth callback
// ---------------------------------------------------------------------------

export class OAuthServer {
  private server: http.Server | null = null
  private state = ''
  private resolve: ((code: string) => void) | null = null
  private reject: ((err: Error) => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  start(): void {
    this.state = crypto.randomUUID()
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res)
    })
    this.server.listen(OAUTH_PORT, '127.0.0.1')
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        this.reject?.(new Error(`Port ${String(OAUTH_PORT)} ist bereits belegt. Bitte versuche es erneut.`))
      } else {
        this.reject?.(err)
      }
    })
  }

  buildAuthUrl(service: string): string {
    const scope = SERVICE_SCOPES[service]
    if (!scope) throw new Error(`Unbekannter Service: ${service}`)

    const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? ''
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope,
      state: this.state,
      access_type: 'offline',
      prompt: 'consent',
    })
    return `${AUTH_ENDPOINT}?${params.toString()}`
  }

  waitForCallback(timeoutMs = 120_000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
      this.timer = setTimeout(() => {
        reject(new Error('Zeitüberschreitung — keine Antwort vom Browser erhalten'))
        void this.stop()
      }, timeoutMs)
    })
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => resolve())
        this.server = null
      } else {
        resolve()
      }
    })
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(OAUTH_PORT)}`)

    if (url.pathname !== '/callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }

    const code = url.searchParams.get('code')
    const incomingState = url.searchParams.get('state')

    if (incomingState !== this.state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body><h1>Fehler: Ungültiger State-Parameter</h1></body></html>')
      this.reject?.(new Error('State-Parameter stimmt nicht überein (CSRF-Schutz)'))
      return
    }

    if (!code) {
      const error = url.searchParams.get('error') ?? 'Kein Code erhalten'
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<html><body><h1>Fehler: ${error}</h1></body></html>`)
      this.reject?.(new Error(error))
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><body><h1>Verbindung erfolgreich!</h1><p>Du kannst dieses Fenster schließen.</p></body></html>')
    this.resolve?.(code)
  }
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

function getCredentialPath(service: string): string {
  return path.join(os.homedir(), '.openclaw', 'credentials', `oauth-${service}.enc`)
}

function readEncryptedToken(service: string): TokenData | null {
  const filePath = getCredentialPath(service)
  try {
    const encrypted = fs.readFileSync(filePath)
    if (!safeStorage.isEncryptionAvailable()) return null
    const json = safeStorage.decryptString(encrypted)
    return JSON.parse(json) as TokenData
  } catch {
    return null
  }
}

function writeEncryptedToken(service: string, token: TokenData): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('safeStorage not available — OAuth token will NOT be persisted to disk')
    return
  }
  const credDir = path.join(os.homedir(), '.openclaw', 'credentials')
  fs.mkdirSync(credDir, { recursive: true })
  const json = JSON.stringify(token)
  const encrypted = safeStorage.encryptString(json)
  fs.writeFileSync(getCredentialPath(service), encrypted, { mode: 0o600 })
}

export async function exchangeAndStoreTokens(code: string, service: string): Promise<void> {
  const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? ''
  const clientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? ''

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  })

  const response = await net.fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token-Exchange fehlgeschlagen: ${String(response.status)} ${text}`)
  }

  const data = (await response.json()) as Record<string, unknown>
  const token: TokenData = {
    access_token: String(data['access_token'] ?? ''),
    refresh_token: String(data['refresh_token'] ?? ''),
    expires_in: Number(data['expires_in'] ?? 3600),
    scope: String(data['scope'] ?? ''),
    obtained_at: Date.now(),
  }

  writeEncryptedToken(service, token)
}

export async function getValidToken(service: string): Promise<string> {
  const token = readEncryptedToken(service)
  if (!token) throw new Error(`Kein Token für ${service} gefunden`)

  const expiresAt = token.obtained_at + token.expires_in * 1000 - 60_000
  if (Date.now() < expiresAt) {
    return token.access_token
  }

  // Token expired — refresh
  const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? ''
  const clientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? ''

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token',
  })

  const response = await net.fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    throw new Error(`Token-Refresh fehlgeschlagen: ${String(response.status)}`)
  }

  const data = (await response.json()) as Record<string, unknown>
  const refreshed: TokenData = {
    access_token: String(data['access_token'] ?? ''),
    refresh_token: token.refresh_token, // Google may not return a new refresh_token
    expires_in: Number(data['expires_in'] ?? 3600),
    scope: token.scope,
    obtained_at: Date.now(),
  }

  writeEncryptedToken(service, refreshed)
  return refreshed.access_token
}

export async function revokeTokens(service: string): Promise<void> {
  const token = readEncryptedToken(service)

  // Best-effort revoke at Google
  if (token) {
    try {
      await net.fetch(`${REVOKE_ENDPOINT}?token=${token.access_token}`, { method: 'POST' })
    } catch {
      // Best-effort — ignore errors
    }
  }

  // Delete local credentials
  const filePath = getCredentialPath(service)
  try {
    fs.unlinkSync(filePath)
  } catch {
    // File may not exist — that's fine
  }
}

export function getIntegrationStatus(): Record<string, boolean> {
  const status: Record<string, boolean> = {}
  for (const service of VALID_SERVICES) {
    const filePath = getCredentialPath(service)
    try {
      fs.accessSync(filePath, fs.constants.F_OK)
      status[service] = true
    } catch {
      status[service] = false
    }
  }
  return status
}
