/**
 * Per-User Tool Factory.
 *
 * Creates user-scoped tool instances (Notes, Reminders, Gmail, Calendar).
 * Gmail/Calendar are only included when the Google provider is configured in
 * the oauth_providers table AND the user has linked OAuth tokens.
 *
 * Uses relative imports to avoid adding @ki-assistent/tools as workspace dependency.
 */

import { createNotesTool } from '../../tools/src/notes.js'
import { createRemindersInstance } from '../../tools/src/reminders.js'
import { createGmailTool } from '../../tools/src/gmail.js'
import { createCalendarTool } from '../../tools/src/calendar.js'
import { createDelegateTool } from '../../tools/src/delegate-tool.js'
import { createAgentFactoryTool } from '../../tools/src/agent-factory.js'
import { decryptToken, encryptToken } from './database/crypto.js'
import { getProvider } from './database/oauth-providers.js'
import type { ExtendedAgentTool, OAuthContext } from '../../tools/src/types.js'
import type { LlmClient } from '../../tools/src/agent-executor.js'

// Minimal pool interface (no cross-package dependency)
interface DbPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

/**
 * Load Google OAuth context from DB for a user.
 * Returns null if provider not configured or no tokens stored.
 */
async function loadGoogleOAuth(
  userId: string,
  pool: DbPool,
): Promise<OAuthContext | null> {
  const provider = await getProvider(pool, 'google')
  if (!provider) return null

  const { rows } = await pool.query(
    'SELECT access_token_enc, refresh_token_enc, expires_at FROM user_oauth_tokens WHERE user_id = $1 AND provider = $2',
    [userId, 'google'],
  )
  if (rows.length === 0) return null

  const row = rows[0]!
  return {
    accessToken: decryptToken(String(row['access_token_enc'])),
    refreshToken: decryptToken(String(row['refresh_token_enc'])),
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    expiresAt: row['expires_at'] ? new Date(String(row['expires_at'])).getTime() : 0,
    onTokenRefreshed: async (newAccessToken: string, newExpiresAt: number) => {
      await pool.query(
        'UPDATE user_oauth_tokens SET access_token_enc = $1, expires_at = $2, updated_at = NOW() WHERE user_id = $3 AND provider = $4',
        [encryptToken(newAccessToken), new Date(newExpiresAt).toISOString(), userId, 'google'],
      )
    },
  }
}

function createConnectPlaceholder(providerId: string, displayName: string): ExtendedAgentTool {
  return {
    name: `connect-${providerId}`,
    description: `Connects the user's ${displayName} account. Opens a browser window for sign-in. Use this when the user needs ${displayName} services but hasn't connected yet.`,
    parameters: { type: 'object' as const, properties: {}, required: [] },
    permissions: [`oauth:${providerId}`],
    requiresConfirmation: true,
    runsOn: 'server',
    execute: async () => ({
      content: [{
        type: 'text' as const,
        text: `The user's ${displayName} account is now connected. Tell them their account is connected and that you can access their emails and calendar from the next message onwards. Do NOT call any other tools. End your response here.`,
      }],
    }),
  }
}

/**
 * Create per-user tool instances for Notes, Reminders, and optionally Gmail/Calendar.
 * Each tool is bound to the given userId via closure.
 *
 * Three cases for Google:
 * 1. Provider not configured (not in DB or pending) → no tools, no placeholder
 * 2. Provider configured + user has OAuth tokens → real Gmail + Calendar tools
 * 3. Provider configured + user has NO tokens → connect-google placeholder
 */
export async function createUserTools(
  userId: string,
  pool: DbPool,
  llmClient?: LlmClient,
): Promise<readonly ExtendedAgentTool[]> {
  const remindersInstance = createRemindersInstance(userId, pool)
  const tools: ExtendedAgentTool[] = [
    createNotesTool(userId, pool),
    remindersInstance.tool,
  ]

  const googleProvider = await getProvider(pool, 'google')
  if (googleProvider) {
    const googleOAuth = await loadGoogleOAuth(userId, pool)
    if (googleOAuth) {
      tools.push(createGmailTool(googleOAuth))
      tools.push(createCalendarTool(googleOAuth))
    } else {
      tools.push(createConnectPlaceholder('google', googleProvider.displayName))
    }
  }

  // Sub-Agent Tools (only when LlmClient available = PostgreSQL mode)
  if (llmClient) {
    tools.push(createDelegateTool(userId, pool, llmClient))
    tools.push(createAgentFactoryTool(userId, pool))
  }

  return tools
}
