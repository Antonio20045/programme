import { app, dialog, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

const CHECK_DELAY_MS = 10_000 // 10 seconds after startup
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

let checkInterval: ReturnType<typeof setInterval> | null = null
let initialTimeout: ReturnType<typeof setTimeout> | null = null

function safeCheckForUpdates(): void {
  try {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error('[updater] Check failed:', err.message)
    })
  } catch (err) {
    console.error('[updater] Check threw:', err instanceof Error ? err.message : String(err))
  }
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) return

  try {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null

    const ghToken = process.env.GH_TOKEN_UPDATER
    if (ghToken) {
      autoUpdater.requestHeaders = { Authorization: `token ${ghToken}` }
    }
  } catch (err) {
    console.error('[updater] Config failed:', err instanceof Error ? err.message : String(err))
    return
  }

  autoUpdater.on('update-available', (info) => {
    const win = mainWindow
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:available', { version: info.version })
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    const win = mainWindow
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return

    void dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update bereit',
        message: `Version ${info.version} wurde heruntergeladen. Jetzt neustarten?`,
        buttons: ['Ja', 'Nein'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message)
  })

  initialTimeout = setTimeout(() => {
    safeCheckForUpdates()
  }, CHECK_DELAY_MS)

  checkInterval = setInterval(() => {
    safeCheckForUpdates()
  }, CHECK_INTERVAL_MS)
}

export function stopAutoUpdater(): void {
  if (initialTimeout !== null) {
    clearTimeout(initialTimeout)
    initialTimeout = null
  }
  if (checkInterval !== null) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}
