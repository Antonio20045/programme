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

  openExternal: (url: string): Promise<void> => {
    return ipcRenderer.invoke('shell:open-external', url)
  },

  openFileDialog: (): Promise<Array<{ name: string; size: number; path: string; buffer: string }> | null> => {
    return ipcRenderer.invoke('dialog:open-file')
  },

  getSetupRequired: (): Promise<boolean> => {
    return ipcRenderer.invoke('setup:get-required')
  },
})
