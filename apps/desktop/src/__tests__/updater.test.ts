import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const eventHandlers = new Map<string, (...args: unknown[]) => void>()

  return {
    isPackaged: true,
    eventHandlers,
    checkForUpdates: vi.fn().mockResolvedValue(null),
    quitAndInstall: vi.fn(),
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      logger: console as unknown,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        eventHandlers.set(event, handler)
      }),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      quitAndInstall: vi.fn(),
    },
    showMessageBox: vi.fn().mockResolvedValue({ response: 1 }),
  }
})

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    },
  },
  dialog: {
    showMessageBox: mocks.showMessageBox,
  },
}))

vi.mock('electron-updater', () => ({
  autoUpdater: mocks.autoUpdater,
}))

import { initAutoUpdater, stopAutoUpdater } from '../main/updater'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockWebContents {
  send: ReturnType<typeof vi.fn>
}

interface MockWindow {
  isDestroyed: ReturnType<typeof vi.fn>
  webContents: MockWebContents
}

function createMockWindow(destroyed = false): MockWindow {
  return {
    isDestroyed: vi.fn().mockReturnValue(destroyed),
    webContents: { send: vi.fn() },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updater', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.isPackaged = true
    mocks.eventHandlers.clear()
    mocks.autoUpdater.on.mockClear()
    mocks.autoUpdater.checkForUpdates.mockClear()
    mocks.autoUpdater.quitAndInstall.mockClear()
    mocks.showMessageBox.mockClear()
    mocks.showMessageBox.mockResolvedValue({ response: 1 })
  })

  afterEach(() => {
    stopAutoUpdater()
    vi.useRealTimers()
  })

  // -----------------------------------------------------------------------
  // initAutoUpdater
  // -----------------------------------------------------------------------

  describe('initAutoUpdater', () => {
    it('does not initialize when app is not packaged', () => {
      mocks.isPackaged = false
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)

      expect(mocks.autoUpdater.on).not.toHaveBeenCalled()
    })

    it('configures autoDownload and autoInstallOnAppQuit', () => {
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)

      expect(mocks.autoUpdater.autoDownload).toBe(true)
      expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(true)
    })

    it('disables logger', () => {
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)

      expect(mocks.autoUpdater.logger).toBeNull()
    })

    it('registers event handlers', () => {
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)

      expect(mocks.eventHandlers.has('update-available')).toBe(true)
      expect(mocks.eventHandlers.has('update-downloaded')).toBe(true)
      expect(mocks.eventHandlers.has('download-progress')).toBe(true)
      expect(mocks.eventHandlers.has('error')).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Check schedule
  // -----------------------------------------------------------------------

  describe('check schedule', () => {
    it('checks for updates after 10s delay', () => {
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)

      expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()

      vi.advanceTimersByTime(10_000)

      expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    it('checks every 4 hours after initial check', () => {
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)
      vi.advanceTimersByTime(10_000) // initial
      mocks.autoUpdater.checkForUpdates.mockClear()

      vi.advanceTimersByTime(4 * 60 * 60 * 1000)

      expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // update-available event
  // -----------------------------------------------------------------------

  describe('update-available', () => {
    it('sends IPC update:available to renderer', () => {
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)
      const handler = mocks.eventHandlers.get('update-available')!
      handler({ version: '1.2.3' })

      expect(win.webContents.send).toHaveBeenCalledWith('update:available', { version: '1.2.3' })
    })

    it('does not crash when window is destroyed', () => {
      const win = createMockWindow(true)

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)
      const handler = mocks.eventHandlers.get('update-available')!

      expect(() => handler({ version: '1.2.3' })).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // update-downloaded event
  // -----------------------------------------------------------------------

  describe('update-downloaded', () => {
    it('shows message box dialog', () => {
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)
      const handler = mocks.eventHandlers.get('update-downloaded')!
      handler({ version: '2.0.0' })

      expect(mocks.showMessageBox).toHaveBeenCalledTimes(1)
      expect(mocks.showMessageBox).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          message: expect.stringContaining('2.0.0') as string,
        }),
      )
    })

    it('calls quitAndInstall when user clicks Ja', async () => {
      mocks.showMessageBox.mockResolvedValue({ response: 0 })
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)
      const handler = mocks.eventHandlers.get('update-downloaded')!
      handler({ version: '2.0.0' })

      // Flush the promise chain
      await vi.advanceTimersByTimeAsync(0)

      expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
    })

    it('does not call quitAndInstall when user clicks Nein', async () => {
      mocks.showMessageBox.mockResolvedValue({ response: 1 })
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)
      const handler = mocks.eventHandlers.get('update-downloaded')!
      handler({ version: '2.0.0' })

      await vi.advanceTimersByTimeAsync(0)

      expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    })

    it('does not crash when window is destroyed', () => {
      const win = createMockWindow(true)

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)
      const handler = mocks.eventHandlers.get('update-downloaded')!

      expect(() => handler({ version: '2.0.0' })).not.toThrow()
      expect(mocks.showMessageBox).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // download-progress event
  // -----------------------------------------------------------------------

  describe('download-progress', () => {
    it('sends IPC update:progress to renderer', () => {
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)
      const handler = mocks.eventHandlers.get('download-progress')!
      handler({ percent: 42, bytesPerSecond: 1000, transferred: 420, total: 1000 })

      expect(win.webContents.send).toHaveBeenCalledWith('update:progress', {
        percent: 42,
        bytesPerSecond: 1000,
        transferred: 420,
        total: 1000,
      })
    })
  })

  // -----------------------------------------------------------------------
  // error event
  // -----------------------------------------------------------------------

  describe('error', () => {
    it('logs to console.error without showing dialog', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)
      const handler = mocks.eventHandlers.get('error')!
      handler(new Error('network failure'))

      expect(spy).toHaveBeenCalled()
      expect(mocks.showMessageBox).not.toHaveBeenCalled()

      spy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // stopAutoUpdater
  // -----------------------------------------------------------------------

  describe('stopAutoUpdater', () => {
    it('stops the check interval', () => {
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)
      stopAutoUpdater()

      vi.advanceTimersByTime(10_000)

      expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    })

    it('does not crash when called without init', () => {
      expect(() => stopAutoUpdater()).not.toThrow()
    })

    it('does not crash when called twice', () => {
      const win = createMockWindow()

      initAutoUpdater(win as unknown as import('electron').BrowserWindow)
      stopAutoUpdater()

      expect(() => stopAutoUpdater()).not.toThrow()
    })
  })
})
