import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ClientRequest } from 'node:http'

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------

const { mockSpawn, mockHttpGet } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockHttpGet: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}))

vi.mock('node:http', () => ({
  default: { get: mockHttpGet },
  get: mockHttpGet,
}))

import { GatewayManager, type GatewayOptions } from '../main/gateway-manager'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockProcess extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  pid: number
  exitCode: number | null
  kill: ReturnType<typeof vi.fn>
}

function createMockProcess(pid = 1234): MockProcess {
  const proc = new EventEmitter() as MockProcess
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.pid = pid
  proc.exitCode = null
  proc.kill = vi.fn()
  return proc
}

function fastOptions(overrides?: Partial<GatewayOptions>): GatewayOptions {
  return {
    command: '/usr/bin/node',
    args: ['server.js'],
    cwd: '/tmp/test-gateway',
    healthCheckIntervalMs: 100,
    healthCheckTimeoutMs: 50,
    restartDelayMs: 100,
    stableAfterMs: 500,
    shutdownTimeoutMs: 200,
    maxRestarts: 5,
    maxHealthFailures: 3,
    port: 18789,
    ...overrides,
  }
}

/** Mock http.get to respond with a given status code */
function mockHealthCheckSuccess(): void {
  mockHttpGet.mockImplementation(
    (_url: string, _opts: Record<string, unknown>, cb: (res: Partial<IncomingMessage>) => void) => {
      const res = new EventEmitter() as Partial<IncomingMessage> & EventEmitter
      res.statusCode = 200
      res.resume = vi.fn()
      // Call callback asynchronously so the req handlers are attached first
      Promise.resolve().then(() => cb(res))
      const req = new EventEmitter() as ClientRequest & EventEmitter
      req.destroy = vi.fn()
      return req
    },
  )
}

/** Mock http.get to emit an error */
function mockHealthCheckFailure(): void {
  mockHttpGet.mockImplementation(() => {
    const req = new EventEmitter() as ClientRequest & EventEmitter
    req.destroy = vi.fn()
    Promise.resolve().then(() => req.emit('error', new Error('Connection refused')))
    return req
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GatewayManager', () => {
  let manager: GatewayManager
  let mockProc: MockProcess

  beforeEach(() => {
    vi.useFakeTimers()

    mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)
    mockHealthCheckSuccess()
  })

  afterEach(() => {
    // Clear all pending timers to avoid leaks — do NOT await manager.stop()
    // here because it would hang under fake timers.
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // start
  // -----------------------------------------------------------------------

  describe('start', () => {
    it('spawns process and sets status to starting', () => {
      manager = new GatewayManager(fastOptions())
      const statuses: string[] = []
      manager.onStatus((s) => statuses.push(s))

      manager.start()

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/bin/node',
        ['server.js'],
        expect.objectContaining({
          cwd: '/tmp/test-gateway',
          stdio: 'pipe',
        }),
      )
      expect(statuses).toContain('starting')
      expect(manager.getStatus()).toBe('starting')
    })

    it('transitions to online after successful health check', async () => {
      manager = new GatewayManager(fastOptions())
      const statuses: string[] = []
      manager.onStatus((s) => statuses.push(s))

      manager.start()

      // Advance past one health check interval + flush microtasks
      await vi.advanceTimersByTimeAsync(150)

      expect(manager.getStatus()).toBe('online')
      expect(statuses).toContain('online')
    })

    it('passes custom env variables merged with process.env', () => {
      manager = new GatewayManager(
        fastOptions({ env: { GATEWAY_MODE: 'headless' } }),
      )

      manager.start()

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          env: expect.objectContaining({ GATEWAY_MODE: 'headless' }),
        }),
      )
    })
  })

  // -----------------------------------------------------------------------
  // health check
  // -----------------------------------------------------------------------

  describe('health check', () => {
    it('calls GET /health on the configured port', async () => {
      manager = new GatewayManager(fastOptions({ port: 19000 }))
      manager.start()

      await vi.advanceTimersByTimeAsync(150)

      expect(mockHttpGet).toHaveBeenCalledWith(
        'http://127.0.0.1:19000/health',
        expect.objectContaining({ timeout: 50 }),
        expect.any(Function),
      )
    })

    it('transitions to offline after 3 consecutive failures', async () => {
      mockHealthCheckFailure()
      manager = new GatewayManager(fastOptions())
      const statuses: string[] = []
      manager.onStatus((s) => statuses.push(s))

      manager.start()

      // 3 health check intervals
      await vi.advanceTimersByTimeAsync(100) // 1st failure
      await vi.advanceTimersByTimeAsync(100) // 2nd failure
      await vi.advanceTimersByTimeAsync(100) // 3rd failure

      expect(manager.getStatus()).toBe('offline')
    })

    it('resets failure counter on successful check', async () => {
      // Start with failures
      mockHealthCheckFailure()
      manager = new GatewayManager(fastOptions())

      manager.start()

      // 2 failures (not enough to go offline at maxHealthFailures=3)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      // Switch to success
      mockHealthCheckSuccess()
      await vi.advanceTimersByTimeAsync(100)

      // Should be online, not offline
      expect(manager.getStatus()).toBe('online')
    })

    it('does not run health check during shutdown', async () => {
      manager = new GatewayManager(fastOptions())
      manager.start()

      await vi.advanceTimersByTimeAsync(150) // go online
      mockHttpGet.mockClear()

      // Trigger shutdown — process exits immediately
      const stopPromise = manager.stop()
      mockProc.exitCode = 0
      mockProc.emit('exit', 0, null)
      await stopPromise

      // Advance timers — no more health checks should fire
      await vi.advanceTimersByTimeAsync(500)

      expect(mockHttpGet).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // auto-restart
  // -----------------------------------------------------------------------

  describe('auto-restart', () => {
    it('restarts process after unexpected exit with delay', async () => {
      manager = new GatewayManager(fastOptions())
      manager.start()
      await vi.advanceTimersByTimeAsync(150) // go online

      mockSpawn.mockClear()
      const newProc = createMockProcess(5678)
      mockSpawn.mockReturnValue(newProc)

      // Simulate crash
      mockProc.exitCode = 1
      mockProc.emit('exit', 1, null)

      // Not restarted yet (restartDelayMs = 100)
      expect(mockSpawn).not.toHaveBeenCalled()

      // Advance past restart delay
      await vi.advanceTimersByTimeAsync(150)

      expect(mockSpawn).toHaveBeenCalledTimes(1)
    })

    it('stops restarting after max attempts and reports error', async () => {
      manager = new GatewayManager(fastOptions({ maxRestarts: 3 }))
      const statuses: string[] = []
      manager.onStatus((s) => statuses.push(s))

      manager.start()
      await vi.advanceTimersByTimeAsync(150)

      // Track the active process for each crash cycle
      let activeProc = mockProc

      // Crash maxRestarts + 1 times (4 total: restarts 1-3 succeed, 4th exceeds limit)
      for (let i = 0; i < 4; i++) {
        const nextProc = createMockProcess(2000 + i)
        mockSpawn.mockReturnValue(nextProc)

        activeProc.exitCode = 1
        activeProc.emit('exit', 1, null)

        await vi.advanceTimersByTimeAsync(150)
        activeProc = nextProc
      }

      expect(statuses).toContain('error')
    })

    it('resets restart counter after stable operation', async () => {
      manager = new GatewayManager(
        fastOptions({ maxRestarts: 2, stableAfterMs: 300 }),
      )

      manager.start()
      await vi.advanceTimersByTimeAsync(150) // go online

      // Crash once
      const proc2 = createMockProcess(2000)
      mockSpawn.mockReturnValue(proc2)
      mockProc.exitCode = 1
      mockProc.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(150) // restart delay fires + health check

      // Go online again and stay stable for stableAfterMs
      await vi.advanceTimersByTimeAsync(150) // health check → online

      // Wait for stable timer to reset counter (300ms)
      await vi.advanceTimersByTimeAsync(400)

      // Now crash again — should restart successfully (counter was reset)
      const proc3 = createMockProcess(3000)
      mockSpawn.mockReturnValue(proc3)
      proc2.exitCode = 1
      proc2.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(150)

      // Should have spawned again (not error)
      expect(manager.getStatus()).not.toBe('error')
    })

    it('does not restart during shutdown', async () => {
      manager = new GatewayManager(fastOptions())
      manager.start()
      await vi.advanceTimersByTimeAsync(150)

      mockSpawn.mockClear()

      // Stop first, then process exits
      const stopPromise = manager.stop()
      mockProc.exitCode = 0
      mockProc.emit('exit', 0, null)
      await stopPromise

      // Advance past any potential restart delay
      await vi.advanceTimersByTimeAsync(500)

      expect(mockSpawn).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // graceful shutdown
  // -----------------------------------------------------------------------

  describe('graceful shutdown', () => {
    it('sends SIGTERM and resolves when process exits', async () => {
      manager = new GatewayManager(fastOptions())
      manager.start()
      await vi.advanceTimersByTimeAsync(150)

      const stopPromise = manager.stop()

      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')

      // Simulate process exiting gracefully
      mockProc.exitCode = 0
      mockProc.emit('exit', 0, 'SIGTERM')

      await stopPromise
    })

    it('sends SIGKILL after shutdown timeout', async () => {
      manager = new GatewayManager(fastOptions({ shutdownTimeoutMs: 200 }))
      manager.start()
      await vi.advanceTimersByTimeAsync(150)

      const stopPromise = manager.stop()

      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')

      // Advance past shutdown timeout without process exiting
      await vi.advanceTimersByTimeAsync(250)

      expect(mockProc.kill).toHaveBeenCalledWith('SIGKILL')

      // Now process exits
      mockProc.exitCode = 137
      mockProc.emit('exit', 137, 'SIGKILL')

      await stopPromise
    })

    it('resolves immediately if no process is running', async () => {
      manager = new GatewayManager(fastOptions())
      // Never started — stop should resolve immediately
      await manager.stop()
    })
  })

  // -----------------------------------------------------------------------
  // status events
  // -----------------------------------------------------------------------

  describe('status events', () => {
    it('fires listener on status change', () => {
      manager = new GatewayManager(fastOptions())
      const statuses: string[] = []
      manager.onStatus((s) => statuses.push(s))

      manager.start()

      expect(statuses).toEqual(['starting'])
    })

    it('does not fire when status is unchanged', async () => {
      manager = new GatewayManager(fastOptions())
      const statuses: string[] = []
      manager.onStatus((s) => statuses.push(s))

      manager.start()
      await vi.advanceTimersByTimeAsync(150) // online

      // Multiple successful health checks should not re-fire 'online'
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      const onlineCount = statuses.filter((s) => s === 'online').length
      expect(onlineCount).toBe(1)
    })

    it('unsubscribe function removes listener', () => {
      manager = new GatewayManager(fastOptions())
      const statuses: string[] = []
      const unsub = manager.onStatus((s) => statuses.push(s))

      unsub()
      manager.start()

      expect(statuses).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // security
  // -----------------------------------------------------------------------

  describe('security', () => {
    it('uses spawn not exec', () => {
      manager = new GatewayManager(fastOptions())
      manager.start()

      expect(mockSpawn).toHaveBeenCalled()
    })

    it('health check connects only to 127.0.0.1', async () => {
      manager = new GatewayManager(fastOptions())
      manager.start()

      await vi.advanceTimersByTimeAsync(150)

      const url = mockHttpGet.mock.calls[0]?.[0] as string | undefined
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:/)
    })
  })

  // -----------------------------------------------------------------------
  // logs
  // -----------------------------------------------------------------------

  describe('logs', () => {
    it('forwards stdout and stderr to log listeners', () => {
      manager = new GatewayManager(fastOptions())
      const logs: Array<{ stream: string; data: string }> = []
      manager.onLog((stream, data) => logs.push({ stream, data }))

      manager.start()

      mockProc.stdout.emit('data', Buffer.from('Server started'))
      mockProc.stderr.emit('data', Buffer.from('Warning: something'))

      expect(logs).toEqual([
        { stream: 'stdout', data: 'Server started' },
        { stream: 'stderr', data: 'Warning: something' },
      ])
    })
  })
})
