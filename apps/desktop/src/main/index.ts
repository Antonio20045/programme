import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { GatewayManager } from './gateway-manager'
import { TrayManager } from './tray'

let mainWindow: BrowserWindow | null = null
let gatewayManager: GatewayManager | null = null
let trayManager: TrayManager | null = null
let isQuitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  // Hide instead of close — tray keeps the app running
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // Block navigation to external URLs and opening new windows
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function setupTray(): void {
  trayManager = new TrayManager({
    getWindow: () => mainWindow,
    onQuit: () => app.quit(),
  })
  trayManager.create()
}

function setupGateway(): void {
  gatewayManager = new GatewayManager({
    command: 'node',
    args: ['dist/index.js'],
    cwd: path.join(__dirname, '../../packages/gateway'),
    port: 18789,
  })

  gatewayManager.onStatus((status) => {
    trayManager?.updateStatus(status)
    const win = mainWindow
    if (win && !win.isDestroyed()) {
      win.webContents.send('gateway:status', status)
    }
  })

  gatewayManager.onLog((stream, data) => {
    if (!app.isPackaged) {
      process.stderr.write(`[gateway:${stream}] ${data}`)
    }
  })

  gatewayManager.start()
}

ipcMain.handle('gateway:get-status', () => {
  return gatewayManager?.getStatus() ?? 'offline'
})

ipcMain.handle('shell:open-external', (_event, url: unknown) => {
  if (typeof url !== 'string') return
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') {
      void shell.openExternal(url)
    }
  } catch {
    // Invalid URL — ignore silently
  }
})

const ALLOWED_EXTENSIONS = ['txt', 'pdf', 'md', 'csv', 'json', 'png', 'jpg', 'docx']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

ipcMain.handle('dialog:open-file', async () => {
  const win = mainWindow
  if (!win || win.isDestroyed()) return null

  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Erlaubte Dateien', extensions: ALLOWED_EXTENSIONS },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const files: Array<{ name: string; size: number; path: string; buffer: string }> = []

  for (const filePath of result.filePaths) {
    const stat = fs.statSync(filePath)
    if (stat.size > MAX_FILE_SIZE) continue

    const buffer = fs.readFileSync(filePath)
    files.push({
      name: path.basename(filePath),
      size: stat.size,
      path: filePath,
      buffer: buffer.toString('base64'),
    })
  }

  return files.length > 0 ? files : null
})

app.whenReady().then(() => {
  createWindow()
  setupTray()
  setupGateway()

  app.on('activate', () => {
    if (isQuitting) return
    if (mainWindow) {
      mainWindow.show()
    } else {
      createWindow()
    }
  })
})

app.on('before-quit', (e) => {
  if (!isQuitting && gatewayManager) {
    isQuitting = true
    e.preventDefault()
    gatewayManager.stop()
      .catch(() => {
        // Shutdown failed — quit anyway
      })
      .finally(() => {
        trayManager?.destroy()
        app.quit()
      })
  }
})

app.on('window-all-closed', () => {
  // Tray keeps the app running — don't quit on any platform
})
