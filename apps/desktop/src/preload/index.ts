import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getGatewayStatus: (): Promise<string> => {
    return ipcRenderer.invoke('gateway:get-status')
  },

  onGatewayStatus: (callback: (status: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string): void => {
      callback(status)
    }
    ipcRenderer.on('gateway:status', handler)
    return () => {
      ipcRenderer.removeListener('gateway:status', handler)
    }
  },

  agentStatus: (): Promise<string> => {
    return ipcRenderer.invoke('agent:status')
  },

  onAgentStatus: (callback: (status: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string): void => {
      callback(status)
    }
    ipcRenderer.on('agent:status-changed', handler)
    return () => {
      ipcRenderer.removeListener('agent:status-changed', handler)
    }
  },

  getGatewayConfig: (): Promise<{ mode: string; serverUrl: string; token: string }> => {
    return ipcRenderer.invoke('config:get-gateway')
  },

  setGatewayConfig: (data: { mode: string; serverUrl?: string; token?: string }): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('config:set-gateway', data)
  },

  testGatewayConnection: (data: { url: string; token: string }): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('config:test-gateway', data)
  },

  gatewayFetch: (data: { method: string; path: string; body?: unknown }): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> => {
    return ipcRenderer.invoke('gateway:fetch', data)
  },

  getStreamUrl: (sessionId: string): Promise<string> => {
    return ipcRenderer.invoke('gateway:get-stream-url', sessionId)
  },

  onGatewayConfigChanged: (callback: (config: { mode: string; serverUrl: string; token: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, config: { mode: string; serverUrl: string; token: string }): void => {
      callback(config)
    }
    ipcRenderer.on('config:gateway-changed', handler)
    return () => {
      ipcRenderer.removeListener('config:gateway-changed', handler)
    }
  },

  openExternal: (url: string): Promise<void> => {
    return ipcRenderer.invoke('shell:open-external', url)
  },

  openFileDialog: (): Promise<Array<{ name: string; size: number; path: string; buffer: string }> | null> => {
    return ipcRenderer.invoke('dialog:open-file')
  },

  getSetupRequired: (): Promise<boolean> => {
    return ipcRenderer.invoke('setup:get-required')
  },

  setupWriteConfig: (config: { name: string; tone: string; provider: string; model: string }): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('setup:write-config', config)
  },

  setupStartGateway: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('setup:start-gateway')
  },

  settingsReadConfig: (): Promise<{ identity: { name: string; theme: string; emoji: string }; model: string; provider: string; apiKeyLast4: string; allowedPaths: string[] }> => {
    return ipcRenderer.invoke('settings:read-config')
  },

  settingsUpdateModel: (data: { model: string }): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('settings:update-model', data)
  },

  settingsUpdatePersona: (data: { name: string; tone: string }): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('settings:update-persona', data)
  },

  settingsAddFolder: (): Promise<{ success: boolean; error?: string; path?: string }> => {
    return ipcRenderer.invoke('settings:add-folder')
  },

  settingsRemoveFolder: (data: { path: string }): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('settings:remove-folder', data)
  },

  integrationsConnect: (data: { service: string }): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('integrations:connect', data)
  },

  integrationsDisconnect: (data: { service: string }): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('integrations:disconnect', data)
  },

  integrationsStatus: (): Promise<{ gmail: boolean; calendar: boolean; drive: boolean }> => {
    return ipcRenderer.invoke('integrations:status')
  },

  memoryRead: (): Promise<{ longTerm: Array<{ id: string; title: string; content: string }>; daily: Array<{ date: string; entries: Array<{ id: string; content: string }> }> }> => {
    return ipcRenderer.invoke('memory:read')
  },

  memoryDelete: (data: { type: string; id: string; date?: string }): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('memory:delete', data)
  },

  activityRead: (data?: { days?: number; offset?: number; limit?: number }): Promise<{ entries: Array<{ id: string; toolName: string; category: string; description: string; params: Record<string, unknown>; result?: unknown; timestamp: string; durationMs?: number }>; hasMore: boolean }> => {
    return ipcRenderer.invoke('activity:read', data)
  },

  pairingInit: (): Promise<{ success: boolean; qrDataUrl?: string; pairingToken?: string; deviceId?: string; expiresAt?: number; safeStorageAvailable?: boolean; error?: string }> => {
    return ipcRenderer.invoke('pairing:init')
  },

  pairingPollStatus: (token: string): Promise<{ success: boolean; paired?: boolean; partnerDeviceId?: string; error?: string }> => {
    return ipcRenderer.invoke('pairing:poll-status', token)
  },

  pairingGetStored: (): Promise<{ paired: boolean; partnerDeviceId?: string; pairedAt?: string; safeStorageAvailable?: boolean }> => {
    return ipcRenderer.invoke('pairing:get-stored')
  },

  pairingUnpair: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('pairing:unpair')
  },

  setClerkToken: (token: string | null): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('auth:set-clerk-token', token)
  },

  getClerkPublishableKey: (): Promise<string | null> => {
    return ipcRenderer.invoke('auth:get-clerk-publishable-key')
  },

  clerkBrowserSignIn: (provider?: string): Promise<{ success: boolean; ticket?: string; error?: string }> => {
    return ipcRenderer.invoke('auth:clerk-browser-signin', provider !== undefined ? { provider } : undefined)
  },
})
