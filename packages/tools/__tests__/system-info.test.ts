import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval } from './helpers'
import { systemInfoTool, parseArgs, parseBatteryOutput } from '../src/system-info'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/system-info.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock child_process.execFile
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn()

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('system-info tool', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockExecFile.mockReset()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(systemInfoTool.name).toBe('system-info')
    })

    it('runs on desktop', () => {
      expect(systemInfoTool.runsOn).toBe('desktop')
    })

    it('has system:read permission', () => {
      expect(systemInfoTool.permissions).toContain('system:read')
    })

    it('does not require confirmation (read-only)', () => {
      expect(systemInfoTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // overview()
  // -------------------------------------------------------------------------

  describe('overview()', () => {
    it('returns system information from os module', async () => {
      const result = await systemInfoTool.execute({ action: 'overview' })

      expect(result.content).toHaveLength(1)
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as Record<string, unknown>

      expect(parsed).toHaveProperty('hostname')
      expect(parsed).toHaveProperty('platform')
      expect(parsed).toHaveProperty('arch')
      expect(parsed).toHaveProperty('release')
      expect(parsed).toHaveProperty('cpuModel')
      expect(parsed).toHaveProperty('cpuCores')
      expect(parsed).toHaveProperty('totalMemory_MB')
      expect(parsed).toHaveProperty('freeMemory_MB')
      expect(parsed).toHaveProperty('uptime_hours')
      expect(parsed).toHaveProperty('loadAverage')

      expect(typeof parsed['hostname']).toBe('string')
      expect(typeof parsed['cpuCores']).toBe('number')
      expect(typeof parsed['totalMemory_MB']).toBe('number')
      expect((parsed['totalMemory_MB'] as number)).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------------------------
  // processes()
  // -------------------------------------------------------------------------

  describe('processes()', () => {
    it('parses ps output into structured data', async () => {
      const psOutput = [
        '  PID  %CPU %MEM COMM',
        '  123  12.3  2.1 /usr/bin/node',
        '  456   8.7  1.5 /Applications/Chrome.app/Contents/MacOS/Chrome',
        '  789   3.2  0.8 /usr/sbin/syslogd',
      ].join('\n')

      mockExecFile.mockImplementation(
        (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
          cb(null, psOutput)
        },
      )

      const result = await systemInfoTool.execute({ action: 'processes' })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { processes: { pid: string; cpu: string; mem: string; name: string }[]; count: number }

      expect(parsed.count).toBe(3)
      expect(parsed.processes[0]).toEqual({
        pid: '123',
        cpu: '12.3',
        mem: '2.1',
        name: '/usr/bin/node',
      })
    })

    it('limits to 50 processes', async () => {
      const header = '  PID  %CPU %MEM COMM'
      const lines = Array.from({ length: 60 }, (_, i) =>
        `  ${String(i + 1)}  1.0  0.5 /usr/bin/process${String(i)}`,
      )
      const psOutput = [header, ...lines].join('\n')

      mockExecFile.mockImplementation(
        (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
          cb(null, psOutput)
        },
      )

      const result = await systemInfoTool.execute({ action: 'processes' })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { count: number }

      expect(parsed.count).toBe(50)
    })

    it('throws on execFile error', async () => {
      mockExecFile.mockImplementation(
        (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
          cb(new Error('ps not found'), '')
        },
      )

      await expect(
        systemInfoTool.execute({ action: 'processes' }),
      ).rejects.toThrow('Command failed')
    })
  })

  // -------------------------------------------------------------------------
  // battery()
  // -------------------------------------------------------------------------

  describe('battery()', () => {
    it('parses battery output (discharging)', async () => {
      const pmsetOutput =
        "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=123)\t72%; discharging; 3:45 remaining"

      mockExecFile.mockImplementation(
        (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
          cb(null, pmsetOutput)
        },
      )

      const result = await systemInfoTool.execute({ action: 'battery' })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { percent: number; charging: boolean; timeRemaining: string }

      expect(parsed.percent).toBe(72)
      expect(parsed.charging).toBe(false)
      expect(parsed.timeRemaining).toBe('3:45')
    })

    it('parses battery output (charging)', async () => {
      const pmsetOutput =
        "Now drawing from 'AC Power'\n -InternalBattery-0 (id=123)\t85%; charging; 1:15 remaining"

      mockExecFile.mockImplementation(
        (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
          cb(null, pmsetOutput)
        },
      )

      const result = await systemInfoTool.execute({ action: 'battery' })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { percent: number; charging: boolean }

      expect(parsed.percent).toBe(85)
      expect(parsed.charging).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // parseBatteryOutput()
  // -------------------------------------------------------------------------

  describe('parseBatteryOutput()', () => {
    it('parses standard discharging format', () => {
      const output = "-InternalBattery-0\t72%; discharging; 3:45 remaining"
      const result = parseBatteryOutput(output)
      expect(result).toEqual({ percent: 72, charging: false, timeRemaining: '3:45' })
    })

    it('parses charging format', () => {
      const output = "-InternalBattery-0\t85%; charging; 1:15 remaining"
      const result = parseBatteryOutput(output)
      expect(result).toEqual({ percent: 85, charging: true, timeRemaining: '1:15' })
    })

    it('parses fully charged (no time remaining)', () => {
      const output = "-InternalBattery-0\t100%; charged; (no estimate)"
      const result = parseBatteryOutput(output)
      expect(result.percent).toBe(100)
      expect(result.charging).toBe(false)
    })

    it('throws when no battery found', () => {
      expect(() => parseBatteryOutput('No battery information')).toThrow('No battery found')
    })
  })

  // -------------------------------------------------------------------------
  // parseArgs()
  // -------------------------------------------------------------------------

  describe('parseArgs()', () => {
    it('parses overview action', () => {
      expect(parseArgs({ action: 'overview' })).toEqual({ action: 'overview' })
    })

    it('parses processes action', () => {
      expect(parseArgs({ action: 'processes' })).toEqual({ action: 'processes' })
    })

    it('parses battery action', () => {
      expect(parseArgs({ action: 'battery' })).toEqual({ action: 'battery' })
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'unknown' })).toThrow('action must be')
    })

    it('rejects null', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects non-object', () => {
      expect(() => parseArgs('string')).toThrow('Arguments must be an object')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no eval/exec patterns', () => {
      assertNoEval(sourceCode)
    })

    it('does not use fetch (no network access needed)', () => {
      // system-info should only use os module and execFile, no network
      const fetchPattern = /\bfetch\s*\(/
      expect(sourceCode).not.toMatch(fetchPattern)
    })

    it('uses execFile not exec', () => {
      expect(sourceCode).toContain('execFile')
      // Verify it imports execFile specifically
      expect(sourceCode).toMatch(/import\s*\{[^}]*execFile/)
    })

    it('uses hardcoded binary paths', () => {
      expect(sourceCode).toContain("'/bin/ps'")
      expect(sourceCode).toContain("'/usr/bin/pmset'")
    })

    it('uses hardcoded arguments (no user input in execFile args)', () => {
      // ps args are hardcoded
      expect(sourceCode).toContain("'-axo'")
      expect(sourceCode).toContain("'pid,%cpu,%mem,comm'")
      // pmset args are hardcoded
      expect(sourceCode).toContain("'-g'")
      expect(sourceCode).toContain("'batt'")
    })
  })
})
