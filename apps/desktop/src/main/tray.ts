/* eslint-disable security/detect-object-injection */
import { Tray, Menu, nativeImage } from 'electron'
import type { BrowserWindow, NativeImage } from 'electron'
import path from 'path'
import type { GatewayStatus } from './gateway-manager'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<GatewayStatus, string> = {
  starting: 'Starting...',
  online: 'Online',
  offline: 'Offline',
  error: 'Fehler',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrayManagerDeps {
  /** Returns the main BrowserWindow (or null if destroyed/not created) */
  getWindow: () => BrowserWindow | null
  /** Called when the user clicks "Beenden" — should trigger app.quit() */
  onQuit: () => void
}

// ---------------------------------------------------------------------------
// TrayManager
// ---------------------------------------------------------------------------

export class TrayManager {
  private tray: Tray | null = null
  private status: GatewayStatus = 'offline'
  private mode: 'local' | 'server' = 'local'
  private readonly getWindow: () => BrowserWindow | null
  private readonly onQuit: () => void
  private readonly icons: Record<GatewayStatus, NativeImage>

  constructor(deps: TrayManagerDeps) {
    this.getWindow = deps.getWindow
    this.onQuit = deps.onQuit
    this.icons = this.loadIcons()
  }

  create(): void {
    if (this.tray) return
    this.tray = new Tray(this.icons[this.status])
    this.tray.setToolTip('KI-Assistent')
    this.rebuildMenu()
    this.setupClickHandlers()
  }

  updateStatus(status: GatewayStatus): void {
    if (status === this.status) return
    this.status = status
    if (!this.tray) return
    this.tray.setImage(this.icons[status])
    this.rebuildMenu()
  }

  updateMode(mode: 'local' | 'server'): void {
    if (mode === this.mode) return
    this.mode = mode
    this.rebuildMenu()
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private loadIcons(): Record<GatewayStatus, NativeImage> {
    const base = path.join(__dirname, '../../assets/tray')
    return {
      online: nativeImage.createFromPath(path.join(base, 'tray-online.png')),
      offline: nativeImage.createFromPath(path.join(base, 'tray-offline.png')),
      starting: nativeImage.createFromPath(path.join(base, 'tray-starting.png')),
      error: nativeImage.createFromPath(path.join(base, 'tray-error.png')),
    }
  }

  private rebuildMenu(): void {
    if (!this.tray) return

    const modeLabel = this.mode === 'server' ? 'Server' : 'Lokal'
    const menu = Menu.buildFromTemplate([
      { label: 'Öffnen', click: () => this.showWindow() },
      { label: `Modus: ${modeLabel}`, enabled: false },
      { label: `Status: ${STATUS_LABELS[this.status]}`, enabled: false },
      { type: 'separator' },
      { label: 'Beenden', click: () => this.onQuit() },
    ])

    this.tray.setContextMenu(menu)
  }

  private showWindow(): void {
    const win = this.getWindow()
    if (!win) return
    win.show()
    win.focus()
  }

  private setupClickHandlers(): void {
    if (!this.tray) return

    if (process.platform === 'darwin') {
      // macOS: single click on tray → show window
      this.tray.on('click', () => this.showWindow())
    } else {
      // Windows/Linux: double-click on tray → show window
      this.tray.on('double-click', () => this.showWindow())
    }
  }
}
