/// <reference types="vite/client" />

type GatewayStatus = 'starting' | 'online' | 'offline' | 'error'

interface SelectedFile {
  name: string
  size: number
  path: string
  buffer: string
}

interface ElectronApi {
  getGatewayStatus: () => Promise<GatewayStatus>
  onGatewayStatus: (callback: (status: GatewayStatus) => void) => () => void
  openExternal: (url: string) => Promise<void>
  openFileDialog: () => Promise<SelectedFile[] | null>
  getSetupRequired: () => Promise<boolean>
}

interface Window {
  api: ElectronApi
}
