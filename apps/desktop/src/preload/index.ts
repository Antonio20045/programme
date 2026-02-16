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
})
