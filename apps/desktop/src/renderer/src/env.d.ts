/// <reference types="vite/client" />

type GatewayStatus = 'starting' | 'online' | 'offline' | 'error'

interface ElectronApi {
  getGatewayStatus: () => Promise<GatewayStatus>
  onGatewayStatus: (callback: (status: GatewayStatus) => void) => () => void
}

interface Window {
  api: ElectronApi
}
