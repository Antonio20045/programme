import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  interface TrayInstance {
    image: unknown
    setImage: ReturnType<typeof vi.fn>
    setToolTip: ReturnType<typeof vi.fn>
    setContextMenu: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
  }

  const instances: TrayInstance[] = []

  class MockTray {
    image: unknown
    setImage = vi.fn()
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    destroy = vi.fn()
    on = vi.fn()

    constructor(image: unknown) {
      this.image = image
      instances.push(this)
    }
  }

  return {
    MockTray,
    instances,
    lastTray: (): TrayInstance => instances[instances.length - 1]!,
    buildFromTemplate: vi.fn().mockReturnValue({}),
    createFromPath: vi.fn().mockReturnValue({}),
  }
})

vi.mock('electron', () => ({
  Tray: mocks.MockTray,
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
  nativeImage: { createFromPath: mocks.createFromPath },
}))

import { TrayManager, type TrayManagerDeps } from '../main/tray'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockWindow {
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
}

function createMockWindow(): MockWindow {
  return { show: vi.fn(), focus: vi.fn() }
}

function createDeps(overrides?: Partial<TrayManagerDeps>): TrayManagerDeps {
  return {
    getWindow: () => null,
    onQuit: vi.fn(),
    ...overrides,
  }
}

type MenuTemplate = Array<{
  label?: string
  click?: () => void
  enabled?: boolean
  type?: string
}>

function getLastMenuTemplate(): MenuTemplate {
  const lastCall = mocks.buildFromTemplate.mock.calls.at(-1) as
    | [MenuTemplate]
    | undefined
  expect(lastCall).toBeDefined()
  return lastCall![0]
}

function withPlatform(platform: string, fn: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
  try {
    fn()
  } finally {
    if (descriptor) {
      Object.defineProperty(process, 'platform', descriptor)
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrayManager', () => {
  beforeEach(() => {
    mocks.instances.length = 0
    mocks.buildFromTemplate.mockClear()
    mocks.createFromPath.mockClear()
  })

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------

  describe('create', () => {
    it('creates a Tray with the offline icon by default', () => {
      const manager = new TrayManager(createDeps())
      manager.create()

      expect(mocks.instances).toHaveLength(1)
    })

    it('sets tooltip to KI-Assistent', () => {
      const manager = new TrayManager(createDeps())
      manager.create()

      expect(mocks.lastTray().setToolTip).toHaveBeenCalledWith('KI-Assistent')
    })

    it('builds context menu on create', () => {
      const manager = new TrayManager(createDeps())
      manager.create()

      expect(mocks.buildFromTemplate).toHaveBeenCalledTimes(1)
      expect(mocks.lastTray().setContextMenu).toHaveBeenCalledTimes(1)
    })

    it('does not create a second tray if already created', () => {
      const manager = new TrayManager(createDeps())
      manager.create()
      manager.create()

      expect(mocks.instances).toHaveLength(1)
    })

    it('loads icons from assets/tray directory', () => {
      new TrayManager(createDeps())

      // 4 statuses → 4 createFromPath calls
      expect(mocks.createFromPath).toHaveBeenCalledTimes(4)
      for (const call of mocks.createFromPath.mock.calls as Array<[string]>) {
        expect(call[0]).toMatch(/assets\/tray\/tray-/)
        expect(call[0]).toMatch(/\.png$/)
      }
    })
  })

  // -----------------------------------------------------------------------
  // context menu
  // -----------------------------------------------------------------------

  describe('context menu', () => {
    it('has Öffnen, Status, separator, and Beenden items', () => {
      const manager = new TrayManager(createDeps())
      manager.create()

      const template = getLastMenuTemplate()

      expect(template).toHaveLength(4)
      expect(template[0]?.label).toBe('Öffnen')
      expect(template[1]?.label).toMatch(/^Status: /)
      expect(template[2]?.type).toBe('separator')
      expect(template[3]?.label).toBe('Beenden')
    })

    it('shows Status: Offline by default', () => {
      const manager = new TrayManager(createDeps())
      manager.create()

      const template = getLastMenuTemplate()
      expect(template[1]?.label).toBe('Status: Offline')
    })

    it('status item is not clickable (enabled: false)', () => {
      const manager = new TrayManager(createDeps())
      manager.create()

      const template = getLastMenuTemplate()
      expect(template[1]?.enabled).toBe(false)
    })

    it('Öffnen shows and focuses the window', () => {
      const mockWindow = createMockWindow()
      const manager = new TrayManager(
        createDeps({ getWindow: () => mockWindow as unknown as import('electron').BrowserWindow }),
      )
      manager.create()

      const template = getLastMenuTemplate()
      template[0]?.click?.()

      expect(mockWindow.show).toHaveBeenCalledTimes(1)
      expect(mockWindow.focus).toHaveBeenCalledTimes(1)
    })

    it('Öffnen does not crash when window is null', () => {
      const manager = new TrayManager(createDeps({ getWindow: () => null }))
      manager.create()

      const template = getLastMenuTemplate()
      expect(() => template[0]?.click?.()).not.toThrow()
    })

    it('Beenden calls onQuit', () => {
      const onQuit = vi.fn()
      const manager = new TrayManager(createDeps({ onQuit }))
      manager.create()

      const template = getLastMenuTemplate()
      template[3]?.click?.()

      expect(onQuit).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // click handlers (platform-specific)
  // -----------------------------------------------------------------------

  describe('click handlers', () => {
    it('registers single-click on macOS', () => {
      withPlatform('darwin', () => {
        const manager = new TrayManager(createDeps())
        manager.create()

        const tray = mocks.lastTray()
        const clickCall = (tray.on.mock.calls as Array<[string, () => void]>).find(
          ([event]) => event === 'click',
        )
        expect(clickCall).toBeDefined()
      })
    })

    it('single-click shows window on macOS', () => {
      withPlatform('darwin', () => {
        const mockWindow = createMockWindow()
        const manager = new TrayManager(
          createDeps({ getWindow: () => mockWindow as unknown as import('electron').BrowserWindow }),
        )
        manager.create()

        const tray = mocks.lastTray()
        const clickCall = (tray.on.mock.calls as Array<[string, () => void]>).find(
          ([event]) => event === 'click',
        )
        clickCall![1]()

        expect(mockWindow.show).toHaveBeenCalledTimes(1)
        expect(mockWindow.focus).toHaveBeenCalledTimes(1)
      })
    })

    it('registers double-click on Windows', () => {
      withPlatform('win32', () => {
        const manager = new TrayManager(createDeps())
        manager.create()

        const tray = mocks.lastTray()
        const dblClickCall = (tray.on.mock.calls as Array<[string, () => void]>).find(
          ([event]) => event === 'double-click',
        )
        expect(dblClickCall).toBeDefined()
      })
    })

    it('registers double-click on Linux', () => {
      withPlatform('linux', () => {
        const manager = new TrayManager(createDeps())
        manager.create()

        const tray = mocks.lastTray()
        const dblClickCall = (tray.on.mock.calls as Array<[string, () => void]>).find(
          ([event]) => event === 'double-click',
        )
        expect(dblClickCall).toBeDefined()
      })
    })
  })

  // -----------------------------------------------------------------------
  // updateStatus
  // -----------------------------------------------------------------------

  describe('updateStatus', () => {
    it('changes tray icon when status changes', () => {
      const manager = new TrayManager(createDeps())
      manager.create()

      manager.updateStatus('online')

      expect(mocks.lastTray().setImage).toHaveBeenCalledTimes(1)
    })

    it('rebuilds menu with new status text', () => {
      const manager = new TrayManager(createDeps())
      manager.create()
      mocks.buildFromTemplate.mockClear()

      manager.updateStatus('online')

      const template = getLastMenuTemplate()
      expect(template[1]?.label).toBe('Status: Online')
    })

    it('shows correct German labels for each status', () => {
      const manager = new TrayManager(createDeps())
      manager.create()

      const expectedLabels: Record<string, string> = {
        starting: 'Status: Starting...',
        online: 'Status: Online',
        offline: 'Status: Offline',
        error: 'Status: Fehler',
      }

      for (const [status, expectedLabel] of Object.entries(expectedLabels)) {
        manager.updateStatus(status as 'starting' | 'online' | 'offline' | 'error')
        const template = getLastMenuTemplate()
        expect(template[1]?.label).toBe(expectedLabel)
      }
    })

    it('deduplicates — same status does not trigger update', () => {
      const manager = new TrayManager(createDeps())
      manager.create()
      const tray = mocks.lastTray()

      manager.updateStatus('online')
      tray.setImage.mockClear()
      mocks.buildFromTemplate.mockClear()

      manager.updateStatus('online')

      expect(tray.setImage).not.toHaveBeenCalled()
      expect(mocks.buildFromTemplate).not.toHaveBeenCalled()
    })

    it('does not crash if called before create()', () => {
      const manager = new TrayManager(createDeps())
      expect(() => manager.updateStatus('online')).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // destroy
  // -----------------------------------------------------------------------

  describe('destroy', () => {
    it('destroys the tray', () => {
      const manager = new TrayManager(createDeps())
      manager.create()
      const tray = mocks.lastTray()

      manager.destroy()

      expect(tray.destroy).toHaveBeenCalledTimes(1)
    })

    it('does not crash if called without create()', () => {
      const manager = new TrayManager(createDeps())
      expect(() => manager.destroy()).not.toThrow()
    })

    it('allows create() after destroy()', () => {
      const manager = new TrayManager(createDeps())
      manager.create()
      manager.destroy()

      manager.create()

      expect(mocks.instances).toHaveLength(2)
    })
  })
})
