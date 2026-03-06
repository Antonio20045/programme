/**
 * OAuth Providers — CRUD for the oauth_providers table.
 *
 * Provider credentials (client_secret) are stored AES-256-GCM encrypted,
 * using the same key/helpers as user_oauth_tokens (crypto.ts).
 */

import { encryptToken, decryptToken } from './crypto.js'

export interface OAuthProvider {
  readonly id: string
  readonly displayName: string
  readonly clientId: string
  readonly clientSecret: string
  readonly authorizeUrl: string
  readonly tokenUrl: string
  readonly revokeUrl: string | null
  readonly scopes: Record<string, string>
  readonly iconUrl: string | null
  readonly enabled: boolean
}

interface DbPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

interface ProviderRow {
  readonly id: unknown
  readonly display_name: unknown
  readonly client_id: unknown
  readonly client_secret_enc: unknown
  readonly authorize_url: unknown
  readonly token_url: unknown
  readonly revoke_url: unknown
  readonly scopes: unknown
  readonly icon_url: unknown
  readonly enabled: unknown
}

function rowToProvider(row: ProviderRow): OAuthProvider | null {
  const clientId = String(row.client_id)
  if (clientId === 'pending') return null

  return {
    id: String(row.id),
    displayName: String(row.display_name),
    clientId,
    clientSecret: decryptToken(String(row.client_secret_enc)),
    authorizeUrl: String(row.authorize_url),
    tokenUrl: String(row.token_url),
    revokeUrl: row.revoke_url ? String(row.revoke_url) : null,
    scopes: (typeof row.scopes === 'object' && row.scopes !== null
      ? row.scopes
      : JSON.parse(String(row.scopes))) as Record<string, string>,
    iconUrl: row.icon_url ? String(row.icon_url) : null,
    enabled: Boolean(row.enabled),
  }
}

/**
 * Get a single provider by ID. Returns null if not found or still pending.
 */
export async function getProvider(pool: DbPool, providerId: string): Promise<OAuthProvider | null> {
  const { rows } = await pool.query(
    'SELECT id, display_name, client_id, client_secret_enc, authorize_url, token_url, revoke_url, scopes, icon_url, enabled FROM oauth_providers WHERE id = $1',
    [providerId],
  )
  if (rows.length === 0) return null
  return rowToProvider(rows[0] as unknown as ProviderRow)
}

/**
 * Get all providers (excluding pending placeholders).
 */
export async function getAllProviders(pool: DbPool): Promise<OAuthProvider[]> {
  const { rows } = await pool.query(
    'SELECT id, display_name, client_id, client_secret_enc, authorize_url, token_url, revoke_url, scopes, icon_url, enabled FROM oauth_providers',
  )
  const providers: OAuthProvider[] = []
  for (const row of rows) {
    const provider = rowToProvider(row as unknown as ProviderRow)
    if (provider) providers.push(provider)
  }
  return providers
}

/**
 * Get enabled providers only (for UI: which providers can the user connect).
 */
export async function getEnabledProviders(pool: DbPool): Promise<OAuthProvider[]> {
  const { rows } = await pool.query(
    "SELECT id, display_name, client_id, client_secret_enc, authorize_url, token_url, revoke_url, scopes, icon_url, enabled FROM oauth_providers WHERE enabled = true AND client_id != 'pending'",
  )
  const providers: OAuthProvider[] = []
  for (const row of rows) {
    const provider = rowToProvider(row as unknown as ProviderRow)
    if (provider) providers.push(provider)
  }
  return providers
}

/**
 * Seed Google provider from ENV vars if the DB entry is still pending.
 * Called once at startup after migrations.
 */
export async function upsertProviderFromEnv(pool: DbPool): Promise<void> {
  const clientId = process.env['GOOGLE_CLIENT_ID']
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET']
  if (!clientId || !clientSecret) return

  const { rows } = await pool.query(
    'SELECT client_id, enabled FROM oauth_providers WHERE id = $1',
    ['google'],
  )

  if (rows.length === 0) return

  const row = rows[0]!
  const currentClientId = String(row['client_id'])
  const currentEnabled = Boolean(row['enabled'])

  // Already has real credentials and is enabled — nothing to do
  if (currentClientId !== 'pending' && currentEnabled) return

  await pool.query(
    'UPDATE oauth_providers SET client_id = $1, client_secret_enc = $2, enabled = true, updated_at = NOW() WHERE id = $3',
    [clientId, encryptToken(clientSecret), 'google'],
  )
}
