/**
 * System Info tool — system overview, top processes, battery status.
 * Uses Node's os module and execFile with hardcoded binary paths.
 *
 * Security:
 * - Absolute binary paths only (/bin/ps, /usr/bin/pmset)
 * - No user input in execFile arguments (all hardcoded)
 * - Sanitized env (only PATH)
 * - Process listing strips command-line args (may contain secrets)
 */

import { execFile as nodeExecFile } from 'node:child_process'
import * as os from 'node:os'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OverviewArgs {
  readonly action: 'overview'
}

interface ProcessesArgs {
  readonly action: 'processes'
}

interface BatteryArgs {
  readonly action: 'battery'
}

type SystemInfoArgs = OverviewArgs | ProcessesArgs | BatteryArgs

interface BatteryInfo {
  readonly percent: number
  readonly charging: boolean
  readonly timeRemaining: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXEC_TIMEOUT_MS = 10_000
const MAX_BUFFER = 512 * 1024
const MAX_PROCESSES = 50

// ---------------------------------------------------------------------------
// execFile helper
// ---------------------------------------------------------------------------

function runExecFile(binary: string, args: readonly string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    nodeExecFile(
      binary,
      [...args],
      {
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: { PATH: process.env['PATH'] ?? '' },
      },
      (error, stdout) => {
        if (error !== null && error.killed === true) {
          reject(new Error(`Command timed out after ${String(EXEC_TIMEOUT_MS)}ms`))
          return
        }
        if (error !== null) {
          reject(new Error(`Command failed: ${error.message}`))
          return
        }
        resolve(String(stdout))
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): SystemInfoArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'overview' || action === 'processes' || action === 'battery') {
    return { action }
  }

  throw new Error('action must be "overview", "processes", or "battery"')
}

// ---------------------------------------------------------------------------
// Battery output parsing
// ---------------------------------------------------------------------------

function parseBatteryOutput(output: string): BatteryInfo {
  // macOS pmset -g batt output example:
  // Now drawing from 'Battery Power'
  //  -InternalBattery-0 (id=...)	72%; discharging; 3:45 remaining
  const percentMatch = output.match(/(\d{1,3})%/)
  if (!percentMatch?.[1]) {
    throw new Error('No battery found')
  }

  const percent = Number(percentMatch[1])
  const charging = output.includes('charging') && !output.includes('discharging')

  const timeMatch = output.match(/(\d+:\d+)\s+remaining/)
  const timeRemaining = timeMatch?.[1] ?? (charging ? 'calculating' : 'N/A')

  return { percent, charging, timeRemaining }
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

function executeOverview(): AgentToolResult {
  const cpus = os.cpus()
  const result = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    cpuModel: cpus[0]?.model ?? 'unknown',
    cpuCores: cpus.length,
    totalMemory_MB: Math.round(os.totalmem() / (1024 * 1024)),
    freeMemory_MB: Math.round(os.freemem() / (1024 * 1024)),
    uptime_hours: Math.round((os.uptime() / 3600) * 100) / 100,
    loadAverage: os.loadavg(),
  }

  return textResult(JSON.stringify(result))
}

async function executeProcesses(): Promise<AgentToolResult> {
  const stdout = await runExecFile('/bin/ps', ['-axo', 'pid,%cpu,%mem,comm', '-r'])

  const lines = stdout.trim().split('\n')
  // Skip header line
  const dataLines = lines.slice(1, MAX_PROCESSES + 1)

  const processes = dataLines.map((line) => {
    const trimmed = line.trim()
    const parts = trimmed.split(/\s+/)
    return {
      pid: parts[0] ?? '',
      cpu: parts[1] ?? '',
      mem: parts[2] ?? '',
      name: parts.slice(3).join(' '),
    }
  })

  return textResult(JSON.stringify({ processes, count: processes.length }))
}

async function executeBattery(): Promise<AgentToolResult> {
  if (os.platform() !== 'darwin') {
    throw new Error('Battery info is only available on macOS')
  }

  const stdout = await runExecFile('/usr/bin/pmset', ['-g', 'batt'])
  const battery = parseBatteryOutput(stdout)

  return textResult(JSON.stringify(battery))
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "overview" (system info), "processes" (top 50 by CPU), "battery" (macOS only)',
      enum: ['overview', 'processes', 'battery'],
    },
  },
  required: ['action'],
}

export const systemInfoTool: ExtendedAgentTool = {
  name: 'system-info',
  description:
    'Get system information. Actions: overview() returns hostname, CPU, memory, uptime, load; processes() returns top 50 processes by CPU usage; battery() returns battery status (macOS only).',
  parameters,
  permissions: ['system:read'],
  requiresConfirmation: false,
  defaultRiskTier: 1,
  runsOn: 'desktop',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'overview':
        return executeOverview()
      case 'processes':
        return executeProcesses()
      case 'battery':
        return executeBattery()
    }
  },
}

export { parseArgs, parseBatteryOutput }
