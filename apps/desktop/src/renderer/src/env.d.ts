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

interface SettingsConfig {
  identity: { name: string; theme: ToneOption; emoji: string }
  model: string
  provider: string
  allowedPaths: string[]
}

interface SettingsUpdateResult {
  success: boolean
  error?: string
}

type ToolPreviewType = 'email' | 'calendar' | 'shell' | 'filesystem' | 'notes' | 'oauth_connect' | 'generic'

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

interface PairingInitResult {
  success: boolean
  qrDataUrl?: string
  pairingToken?: string
  deviceId?: string
  expiresAt?: number
  safeStorageAvailable?: boolean
  error?: string
}

interface PairingPollResult {
  success: boolean
  paired?: boolean
  partnerDeviceId?: string
  error?: string
}

interface StoredPairingInfo {
  paired: boolean
  partnerDeviceId?: string
  pairedAt?: string
  safeStorageAvailable?: boolean
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
  setupWriteConfig: (config: SetupConfig) => Promise<SetupResult>
  setupStartGateway: () => Promise<SetupResult>
  settingsReadConfig: () => Promise<SettingsConfig>
  settingsUpdateModel: (data: { model: string }) => Promise<SettingsUpdateResult>
  settingsUpdatePersona: (data: { name: string; tone: string }) => Promise<SettingsUpdateResult>
  settingsAddFolder: () => Promise<SettingsUpdateResult & { path?: string }>
  settingsRemoveFolder: (data: { path: string }) => Promise<SettingsUpdateResult>
  integrationsConnect: (data: { service: OAuthService }) => Promise<SetupResult>
  integrationsDisconnect: (data: { service: OAuthService }) => Promise<SetupResult>
  integrationsStatus: () => Promise<IntegrationStatus>
  memoryRead: () => Promise<MemoryData>
  memoryDelete: (data: { type: 'longTerm' | 'daily'; id: string; date?: string }) => Promise<SetupResult>
  activityRead: (data?: { days?: number; offset?: number; limit?: number }) => Promise<ActivityData>
  pairingInit: () => Promise<PairingInitResult>
  pairingPollStatus: (token: string) => Promise<PairingPollResult>
  pairingGetStored: () => Promise<StoredPairingInfo>
  pairingUnpair: () => Promise<SetupResult>
  setClerkToken: (token: string | null) => Promise<{ success: boolean; error?: string }>
  getClerkPublishableKey: () => Promise<string | null>
  clerkBrowserSignIn: (provider?: string) => Promise<{ success: boolean; ticket?: string; error?: string }>
  startOAuth: (data: { service: string }) => Promise<{
    success: boolean; error?: string;
    tokens?: { accessToken: string; refreshToken: string; expiresAt: number }
  }>
  updateOAuthToken: (data: { provider: string; accessToken: string; expiresAt: number }) => Promise<{ success: boolean }>
  onNotification: (callback: (notification: {
    id: string; agentId: string; agentName: string;
    type: string; summary: string; detail?: string;
    priority: string; createdAt: number; proposalIds?: readonly string[];
  }) => void) => () => void
  onNotificationFocus: (callback: (notificationId: string) => void) => () => void
  acknowledgeNotification: (id: string) => Promise<{ success: boolean; error?: string }>
}

interface Window {
  api: ElectronApi
}
