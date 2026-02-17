/// <reference types="vite/client" />

type GatewayStatus = 'starting' | 'online' | 'offline' | 'error'

type AgentStatus = 'connected' | 'disconnected' | 'local'

type GatewayMode = 'local' | 'server'

interface GatewayConfig {
  mode: GatewayMode
  serverUrl: string
  token: string
}

interface GatewayConfigUpdate {
  mode: GatewayMode
  serverUrl?: string
  token?: string
}

interface TestConnectionResult {
  success: boolean
  error?: string
}

interface GatewayFetchResult {
  ok: boolean
  status: number
  data: unknown
  error?: string
}

type ToneOption = 'professional' | 'friendly' | 'concise'

interface SelectedFile {
  name: string
  size: number
  path: string
  buffer: string
}

interface SetupConfig {
  name: string
  tone: ToneOption
  provider: string
  model: string
}

interface SetupResult {
  success: boolean
  error?: string
}

interface ValidationResult {
  valid: boolean
  error?: string
}

interface SettingsConfig {
  identity: { name: string; theme: ToneOption; emoji: string }
  model: string
  provider: string
  apiKeyLast4: string
  allowedPaths: string[]
}

interface SettingsUpdateResult {
  success: boolean
  error?: string
}

interface ApiKeyInfo {
  provider: string
  last4: string
}

type ToolPreviewType = 'email' | 'calendar' | 'shell' | 'filesystem' | 'notes' | 'generic'

interface ToolPreview {
  type: ToolPreviewType
  fields: Record<string, string>
  warning?: string
}

type OAuthService = 'gmail' | 'calendar' | 'drive'

interface IntegrationStatus {
  gmail: boolean
  calendar: boolean
  drive: boolean
}

interface MemoryEntry {
  id: string
  title: string
  content: string
}

interface DailyMemory {
  date: string
  entries: Array<{ id: string; content: string }>
}

interface MemoryData {
  longTerm: MemoryEntry[]
  daily: DailyMemory[]
}

interface ActivityEntry {
  id: string
  toolName: string
  category: string
  description: string
  params: Record<string, unknown>
  result?: unknown
  timestamp: string
  durationMs?: number
}

interface ActivityData {
  entries: ActivityEntry[]
  hasMore: boolean
}

interface ElectronApi {
  getGatewayStatus: () => Promise<GatewayStatus>
  onGatewayStatus: (callback: (status: GatewayStatus) => void) => () => void
  agentStatus: () => Promise<AgentStatus>
  onAgentStatus: (callback: (status: AgentStatus) => void) => () => void
  getGatewayConfig: () => Promise<GatewayConfig>
  setGatewayConfig: (config: GatewayConfigUpdate) => Promise<SettingsUpdateResult>
  testGatewayConnection: (data: { url: string; token: string }) => Promise<TestConnectionResult>
  gatewayFetch: (data: { method: string; path: string; body?: unknown }) => Promise<GatewayFetchResult>
  getStreamUrl: (sessionId: string) => Promise<string>
  onGatewayConfigChanged: (callback: (config: GatewayConfig) => void) => () => void
  openExternal: (url: string) => Promise<void>
  openFileDialog: () => Promise<SelectedFile[] | null>
  getSetupRequired: () => Promise<boolean>
  setupValidateApiKey: (data: { provider: string; apiKey: string }) => Promise<ValidationResult>
  setupStoreApiKey: (data: { provider: string; apiKey: string }) => Promise<SetupResult>
  setupWriteConfig: (config: SetupConfig) => Promise<SetupResult>
  setupStartGateway: () => Promise<SetupResult>
  settingsReadConfig: () => Promise<SettingsConfig>
  settingsUpdateModel: (data: { model: string }) => Promise<SettingsUpdateResult>
  settingsUpdatePersona: (data: { name: string; tone: string }) => Promise<SettingsUpdateResult>
  settingsAddFolder: () => Promise<SettingsUpdateResult & { path?: string }>
  settingsRemoveFolder: (data: { path: string }) => Promise<SettingsUpdateResult>
  settingsReadApiKeyInfo: () => Promise<ApiKeyInfo>
  integrationsConnect: (data: { service: OAuthService }) => Promise<SetupResult>
  integrationsDisconnect: (data: { service: OAuthService }) => Promise<SetupResult>
  integrationsStatus: () => Promise<IntegrationStatus>
  memoryRead: () => Promise<MemoryData>
  memoryDelete: (data: { type: 'longTerm' | 'daily'; id: string; date?: string }) => Promise<SetupResult>
  activityRead: (data?: { days?: number; offset?: number; limit?: number }) => Promise<ActivityData>
}

interface Window {
  api: ElectronApi
}
