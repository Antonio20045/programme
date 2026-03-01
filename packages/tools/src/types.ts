/**
 * Tool type definitions for the KI-Assistent tool system.
 * Zero external dependencies — all types defined inline.
 */

export interface JSONSchemaProperty {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
  readonly description?: string
  readonly enum?: readonly string[]
  readonly items?: JSONSchemaProperty
  readonly properties?: Readonly<Record<string, JSONSchemaProperty>>
  readonly required?: readonly string[]
}

export interface JSONSchema {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, JSONSchemaProperty>>
  readonly required?: readonly string[]
}

export interface TextContent {
  readonly type: 'text'
  readonly text: string
}

export interface ImageContent {
  readonly type: 'image'
  readonly data: string
  readonly mimeType: string
}

export type ToolContent = TextContent | ImageContent

export interface AgentToolResult {
  readonly content: readonly ToolContent[]
}

export type ToolRunsOn = 'server' | 'desktop'

/**
 * Risk tier for tool actions.
 * 0 = Pure computation (no external effect)
 * 1 = Read-only operations (auto-execute, audit-logged)
 * 2 = Create/modify local (preview + 1-click approve)
 * 3 = Send externally / publish (detail preview + approve)
 * 4 = Delete / irreversible (explicit confirmation required)
 */
export type RiskTier = 0 | 1 | 2 | 3 | 4

export interface ExtendedAgentTool {
  readonly name: string
  readonly description: string
  readonly parameters: JSONSchema
  readonly permissions: readonly string[]
  readonly requiresConfirmation: boolean
  readonly runsOn: ToolRunsOn
  /** Per-action risk tiers. Key = action name, value = tier. */
  readonly riskTiers?: Readonly<Record<string, RiskTier>>
  /** Fallback tier when action is not in riskTiers. */
  readonly defaultRiskTier?: RiskTier
  readonly execute: (args: unknown) => Promise<AgentToolResult>
}

/**
 * Minimal database pool interface.
 * Compatible with pg.Pool — tools don't depend on pg directly.
 */
export interface DbPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

export interface OAuthContext {
  readonly accessToken: string
  readonly refreshToken: string
  readonly clientId: string
  readonly clientSecret: string
  readonly expiresAt: number // Unix timestamp ms, 0 = unknown
  readonly onTokenRefreshed?: (newAccessToken: string, newExpiresAt: number) => Promise<void>
}

/** @deprecated Use OAuthContext instead */
export type GoogleOAuthContext = OAuthContext
