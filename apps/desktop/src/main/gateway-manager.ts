import { spawn, type ChildProcess } from 'node:child_process'
import http from 'node:http'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GatewayStatus = 'starting' | 'online' | 'offline' | 'error'

export interface GatewayOptions {
  /** Command to spawn, e.g. 'node' or path to binary */
  command: string
  /** Arguments passed to spawn */
  args: readonly string[]
  /** Working directory for the gateway process */
  cwd: string
  /** Extra environment variables (merged with process.env) */
  env?: Record<string, string>
  /** Port for health checks (default 18789) */
  port?: number
  /** Health check interval in ms (default 5000) */
  healthCheckIntervalMs?: number
  /** Health check timeout in ms (default 3000) */
  healthCheckTimeoutMs?: number
  /** Max consecutive health failures before 'offline' (default 3) */
  maxHealthFailures?: number
  /** Delay before restart attempt in ms (default 3000) */
  restartDelayMs?: number
  /** Max restart attempts before giving up (default 5) */
  maxRestarts?: number
  /** Time in ms after which restart counter resets (default 60000) */
  stableAfterMs?: number
  /** Graceful shutdown timeout before SIGKILL in ms (default 5000) */
  shutdownTimeoutMs?: number
}

type StatusListener = (status: GatewayStatus) => void
type LogListener = (stream: 'stdout' | 'stderr', data: string) => void

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 18789
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_HEALTH_INTERVAL = 5_000
const DEFAULT_HEALTH_TIMEOUT = 3_000
const DEFAULT_MAX_HEALTH_FAILURES = 3
const DEFAULT_RESTART_DELAY = 3_000
const DEFAULT_MAX_RESTARTS = 5
const DEFAULT_STABLE_AFTER = 60_000
const DEFAULT_SHUTDOWN_TIMEOUT = 5_000

// ---------------------------------------------------------------------------
// GatewayManager
// ---------------------------------------------------------------------------

export class GatewayManager {
  // -- Config (resolved with defaults) --
  private readonly command: string
  private readonly args: readonly string[]
  private readonly cwd: string
  private readonly env: Record<string, string> | undefined
  private readonly port: number
  private readonly healthCheckIntervalMs: number
  private readonly healthCheckTimeoutMs: number
  private readonly maxHealthFailures: number
  private readonly restartDelayMs: number
  private readonly maxRestarts: number
  private readonly stableAfterMs: number
  private readonly shutdownTimeoutMs: number

  // -- Runtime state --
  private child: ChildProcess | null = null
  private status: GatewayStatus = 'offline'
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private consecutiveFailures = 0
  private restartCount = 0
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private isShuttingDown = false

  // -- Listeners --
  private readonly statusListeners = new Set<StatusListener>()
  private readonly logListeners = new Set<LogListener>()

  constructor(options: GatewayOptions) {
    this.command = options.command
    this.args = options.args
    this.cwd = options.cwd
    this.env = options.env
    this.port = options.port ?? DEFAULT_PORT
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? DEFAULT_HEALTH_INTERVAL
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT
    this.maxHealthFailures = options.maxHealthFailures ?? DEFAULT_MAX_HEALTH_FAILURES
    this.restartDelayMs = options.restartDelayMs ?? DEFAULT_RESTART_DELAY
    this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS
    this.stableAfterMs = options.stableAfterMs ?? DEFAULT_STABLE_AFTER
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  start(): void {
    if (this.child !== null) return
    this.isShuttingDown = false
    this.restartCount = 0
    this.consecutiveFailures = 0
    this.clearRestartTimer()
    this.spawnProcess()
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true
    this.stopHealthCheck()
    this.clearStableTimer()
    this.clearRestartTimer()

    if (!this.child) {
      return
    }

    await this.killProcess()
  }

  getStatus(): GatewayStatus {
    return this.status
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.add(listener)
    return () => {
      this.logListeners.delete(listener)
    }
  }

  // -----------------------------------------------------------------------
  // Private — status
  // -----------------------------------------------------------------------

  private setStatus(newStatus: GatewayStatus): void {
    if (newStatus === this.status) return
    this.status = newStatus
    for (const listener of this.statusListeners) {
      listener(newStatus)
    }
  }

  // -----------------------------------------------------------------------
  // Private — process lifecycle
  // -----------------------------------------------------------------------

  private spawnProcess(): void {
    this.setStatus('starting')

    const spawnEnv = this.env
      ? { ...process.env, ...this.env }
      : process.env

    this.child = spawn(this.command, [...this.args], {
      cwd: this.cwd,
      env: spawnEnv,
      stdio: 'pipe',
    })

    this.setupProcessListeners()
    this.startHealthCheck()
  }

  private setupProcessListeners(): void {
    const child = this.child
    if (!child) return

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      for (const listener of this.logListeners) {
        listener('stdout', text)
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      for (const listener of this.logListeners) {
        listener('stderr', text)
      }
    })

    child.on('exit', () => {
      this.handleProcessExit()
    })

    child.on('error', (err) => {
      for (const listener of this.logListeners) {
        listener('stderr', `Process error: ${err.message}`)
      }
      // The 'exit' event will also fire after 'error' in most cases.
      // If the process never started, handleProcessExit handles restart.
    })
  }

  private handleProcessExit(): void {
    this.child = null
    this.stopHealthCheck()
    this.clearStableTimer()

    if (this.isShuttingDown) return

    this.setStatus('offline')
    this.scheduleRestart()
  }

  // -----------------------------------------------------------------------
  // Private — restart
  // -----------------------------------------------------------------------

  private scheduleRestart(): void {
    if (this.isShuttingDown) return

    this.restartCount++

    if (this.restartCount > this.maxRestarts) {
      this.setStatus('error')
      return
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.isShuttingDown) {
        this.spawnProcess()
      }
    }, this.restartDelayMs)
  }

  private startStableTimer(): void {
    this.clearStableTimer()
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null
      this.restartCount = 0
    }, this.stableAfterMs)
  }

  private clearStableTimer(): void {
    if (this.stableTimer !== null) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  // -----------------------------------------------------------------------
  // Private — health check
  // -----------------------------------------------------------------------

  private startHealthCheck(): void {
    this.stopHealthCheck()
    this.consecutiveFailures = 0

    this.healthCheckTimer = setInterval(() => {
      if (this.isShuttingDown) return

      void this.performHealthCheck().then((ok) => {
        if (this.isShuttingDown) return

        if (ok) {
          this.consecutiveFailures = 0
          if (this.status !== 'online') {
            this.setStatus('online')
            this.startStableTimer()
          }
        } else {
          this.consecutiveFailures++
          if (this.consecutiveFailures >= this.maxHealthFailures) {
            this.setStatus('offline')
          }
        }
      })
    }, this.healthCheckIntervalMs)
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer !== null) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  private performHealthCheck(): Promise<boolean> {
    return new Promise((resolve) => {
      const url = `http://${DEFAULT_HOST}:${String(this.port)}/health`

      const req = http.get(url, { timeout: this.healthCheckTimeoutMs }, (res) => {
        // Consume body to free resources
        res.resume()
        resolve(res.statusCode === 200)
      })

      req.on('error', () => {
        resolve(false)
      })

      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
    })
  }

  // -----------------------------------------------------------------------
  // Private — shutdown / kill
  // -----------------------------------------------------------------------

  private killProcess(): Promise<void> {
    return new Promise((resolve) => {
      const child = this.child
      if (!child || child.exitCode !== null || !child.pid) {
        this.child = null
        resolve()
        return
      }

      const pid = child.pid

      let resolved = false
      const done = (): void => {
        if (resolved) return
        resolved = true
        this.child = null
        resolve()
      }

      // Force kill after timeout
      const forceKillTimer = setTimeout(() => {
        if (child.exitCode !== null) {
          done()
          return
        }

        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(pid), '/F', '/T'])
        } else {
          child.kill('SIGKILL')
        }
      }, this.shutdownTimeoutMs)

      // Single exit listener: clear timer + resolve
      child.once('exit', () => {
        clearTimeout(forceKillTimer)
        done()
      })

      // Send graceful signal
      if (process.platform === 'win32') {
        const killProc = spawn('taskkill', ['/pid', String(pid), '/T'])
        killProc.on('error', () => {
          // taskkill failed — force kill immediately
          spawn('taskkill', ['/pid', String(pid), '/F', '/T'])
        })
      } else {
        child.kill('SIGTERM')
      }
    })
  }
}
