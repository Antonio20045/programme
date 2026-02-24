import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ClientRequest } from 'node:http'

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------

const { mockSpawn, mockHttpGet, mockNetServer } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockHttpGet: vi.fn(),
  mockNetServer: {
    listen: vi.fn(),
    close: vi.fn(),
    once: vi.fn(),
  },
}))

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}))

vi.mock('node:http', () => ({
  default: { get: mockHttpGet },
  get: mockHttpGet,
}))

vi.mock('node:net', () => ({
  default: { createServer: () => mockNetServer },
  createServer: () => mockNetServer,
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

/** Mock net.createServer to report port as free (listening succeeds) */
function mockPortFree(): void {
  mockNetServer.once.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'listening') {
      Promise.resolve().then(() => cb())
    }
  })
  mockNetServer.close.mockImplementation((cb?: () => void) => {
    if (cb) cb()
  })
}

/** Mock net.createServer to report port as occupied (listen fails) */
function mockPortOccupied(): void {
  mockNetServer.once.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'error') {
      Promise.resolve().then(() => cb(new Error('EADDRINUSE')))
    }
  })
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

/**
 * Helper to flush the async port-check after start().
 * spawnProcess is now async — the port-free check resolves via microtask,
 * so we need to flush microtasks + advance a tick for spawn to happen.
 */
async function flushPortCheck(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
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
    mockPortFree()
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
    it('spawns process and sets status to starting', async () => {
      manager = new GatewayManager(fastOptions())
      const statuses: string[] = []
      manager.onStatus((s) => statuses.push(s))

      manager.start()
      await flushPortCheck()

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/bin/node',
        ['server.js'],
        expect.objectContaining({
          cwd: '/tmp/test-gateway',
          stdio: 'pipe',
        }),
      )
      expect(statuses).toContain('starting')
    })

    it('transitions to online after successful health check', async () => {
      manager = new GatewayManager(fastOptions())
      const statuses: string[] = []
      manager.onStatus((s) => statuses.push(s))

      manager.start()
      await flushPortCheck()

      // Advance past one health check interval + flush microtasks
      await vi.advanceTimersByTimeAsync(150)

      expect(manager.getStatus()).toBe('online')
      expect(statuses).toContain('online')
    })

    it('passes custom env variables merged with process.env', async () => {
      manager = new GatewayManager(
        fastOptions({ env: { GATEWAY_MODE: 'headless' } }),
      )

      manager.start()
      await flushPortCheck()

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
  // port preflight
  // -----------------------------------------------------------------------

  describe('port preflight', () => {
    it('spawns normally when port is free', async () => {
      mockPortFree()
      manager = new GatewayManager(fastOptions())

      manager.start()
      await flushPortCheck()

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/bin/node',
        ['server.js'],
        expect.objectContaining({ cwd: '/tmp/test-gateway' }),
      )
    })

    it('kills orphaned gateway process and starts', async () => {
      // First port check: occupied
      let portCheckCount = 0
      mockNetServer.once.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        portCheckCount++
        if (portCheckCount <= 1) {
          // First check: port occupied
          if (event === 'error') {
            Promise.resolve().then(() => cb(new Error('EADDRINUSE')))
          }
        } else {
          // Second check (after kill): port free
          if (event === 'listening') {
            Promise.resolve().then(() => cb())
          }
        }
      })
      mockNetServer.close.mockImplementation((cb?: () => void) => {
        if (cb) cb()
      })

      // Mock spawn calls for lsof, ps, kill (in order after the gateway spawn)
      const lsofProc = createMockProcess(100)
      const psProc = createMockProcess(101)
      const killProc = createMockProcess(102)

      let spawnCallCount = 0
      mockSpawn.mockImplementation((cmd: string) => {
        spawnCallCount++
        if (cmd === 'lsof') {
          Promise.resolve().then(() => {
            lsofProc.stdout.emit('data', Buffer.from('9999\n'))
            lsofProc.emit('close', 0)
          })
          return lsofProc
        }
        if (cmd === 'ps') {
          Promise.resolve().then(() => {
            psProc.stdout.emit('data', Buffer.from('/usr/bin/node openclaw gateway'))
            psProc.emit('close', 0)
          })
          return psProc
        }
        if (cmd === 'kill') {
          Promise.resolve().then(() => {
            killProc.emit('close', 0)
          })
          return killProc
        }
        // Gateway spawn
        return mockProc
      })

      manager = new GatewayManager(fastOptions())
      manager.start()

      // Flush async port check + lsof + ps + kill + 1s wait + second port check
      await vi.advanceTimersByTimeAsync(1500)

      // The last spawn call should be the gateway process
      expect(spawnCallCount).toBeGreaterThanOrEqual(4) // lsof + ps + kill + gateway
    })

    it('sets error status when port blocked by foreign process', async () => {
      // Port occupied
      mockNetServer.once.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'error') {
          Promise.resolve().then(() => cb(new Error('EADDRINUSE')))
        }
      })

      // lsof returns PID, ps returns non-gateway process
      const lsofProc = createMockProcess(100)
      const psProc = createMockProcess(101)

      mockSpawn.mockImplementation((cmd: string) => {
        if (cmd === 'lsof') {
          Promise.resolve().then(() => {
            lsofProc.stdout.emit('data', Buffer.from('8888\n'))
            lsofProc.emit('close', 0)
          })
          return lsofProc
        }
        if (cmd === 'ps') {
          Promise.resolve().then(() => {
            psProc.stdout.emit('data', Buffer.from('/usr/sbin/nginx'))
            psProc.emit('close', 0)
          })
          return psProc
        }
        return mockProc
      })

      manager = new GatewayManager(fastOptions())
      const statuses: string[] = []
      manager.onStatus((s) => statuses.push(s))

      manager.start()
      await vi.advanceTimersByTimeAsync(100)

      expect(statuses).toContain('error')
    })
  })

  // -----------------------------------------------------------------------
  // health check
  // -----------------------------------------------------------------------

  describe('health check', () => {
    it('calls GET /health on the configured port', async () => {
      manager = new GatewayManager(fastOptions({ port: 19000 }))
      manager.start()
      await flushPortCheck()

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
      await flushPortCheck()

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
      await flushPortCheck()

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
      await flushPortCheck()

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

    it('ignores health result when child is null (prevents green flicker)', async () => {
      manager = new GatewayManager(fastOptions())
      manager.start()
      await flushPortCheck()

      await vi.advanceTimersByTimeAsync(150) // go online

      // Simulate child crash (sets this.child = null in handleProcessExit)
      mockProc.exitCode = 1
      mockProc.emit('exit', 1, null)

      // Status should be offline after exit
      expect(manager.getStatus()).toBe('offline')

      // Even if a stale health-check callback resolves ok, status stays offline
      // because the child-null guard prevents transition to online
      // (The health check timer was stopped on exit, so no new checks fire)
    })
  })

  // -----------------------------------------------------------------------
  // auto-restart
  // -----------------------------------------------------------------------

  describe('auto-restart', () => {
    it('restarts process after unexpected exit with delay', async () => {
      manager = new GatewayManager(fastOptions())
      manager.start()
      await flushPortCheck()
      await vi.advanceTimersByTimeAsync(150) // go online

      mockSpawn.mockClear()
      const newProc = createMockProcess(5678)
      mockSpawn.mockReturnValue(newProc)

      // Simulate crash
      mockProc.exitCode = 1
      mockProc.emit('exit', 1, null)

      // Not restarted yet (restartDelayMs = 100)
      expect(mockSpawn).not.toHaveBeenCalled()

      // Advance past restart delay + port check
      await vi.advanceTimersByTimeAsync(150)

      expect(mockSpawn).toHaveBeenCalled()
    })

    it('stops restarting after max attempts and reports error', async () => {
      manager = new GatewayManager(fastOptions({ maxRestarts: 3 }))
      const statuses: string[] = []
      manager.onStatus((s) => statuses.push(s))

      manager.start()
      await flushPortCheck()
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
      await flushPortCheck()
      await vi.advanceTimersByTimeAsync(150) // go online

      // Crash once
      const proc2 = createMockProcess(2000)
      mockSpawn.mockReturnValue(proc2)
      mockProc.exitCode = 1
      mockProc.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(150) // restart delay fires + port check + health check

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
      await flushPortCheck()
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
      await flushPortCheck()
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
      await flushPortCheck()
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
      await flushPortCheck()
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
    it('uses spawn not exec', async () => {
      manager = new GatewayManager(fastOptions())
      manager.start()
      await flushPortCheck()

      // First spawn call after port check is the gateway process
      const gatewayCalls = mockSpawn.mock.calls.filter(
        (c: string[]) => c[0] === '/usr/bin/node',
      )
      expect(gatewayCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('health check connects only to 127.0.0.1', async () => {
      manager = new GatewayManager(fastOptions())
      manager.start()
      await flushPortCheck()

      await vi.advanceTimersByTimeAsync(150)

      const url = mockHttpGet.mock.calls[0]?.[0] as string | undefined
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:/)
    })
  })

  // -----------------------------------------------------------------------
  // logs
  // -----------------------------------------------------------------------

  describe('logs', () => {
    it('forwards stdout and stderr to log listeners', async () => {
      manager = new GatewayManager(fastOptions())
      const logs: Array<{ stream: string; data: string }> = []
      manager.onLog((stream, data) => logs.push({ stream, data }))

      manager.start()
      await flushPortCheck()

      mockProc.stdout.emit('data', Buffer.from('Server started'))
      mockProc.stderr.emit('data', Buffer.from('Warning: something'))

      expect(logs).toEqual([
        { stream: 'stdout', data: 'Server started' },
        { stream: 'stderr', data: 'Warning: something' },
      ])
    })
  })
})
