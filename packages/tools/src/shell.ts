/**
 * Shell tool — executes commands via execFile (no shell interpreter).
 * All actions require user confirmation before execution.
 *
 * Security layers (defense in depth):
 * 1. execFile() with array arguments — no shell interpreter, no metachar expansion
 * 2. Blocked binary names — shells, interpreters, privilege escalation, dangerous tools
 * 3. Blocked command patterns — destructive flag combinations
 * 4. Shell metacharacter rejection — ;  |  `  $()  &&  ||  &  >  <  newlines  null bytes
 * 5. Sanitized env — only PATH is inherited, no secrets leak
 */

import { execFile as nodeExecFile } from 'node:child_process'
import { homedir } from 'node:os'
import type { AgentToolResult, ExtendedAgentTool, TextContent } from './types'

/** Default timeout in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000

/** Maximum stdout/stderr buffer size (1 MB). */
const MAX_BUFFER = 1024 * 1024

/**
 * Binaries that are always blocked by basename.
 * Shells and interpreters can execute arbitrary code, bypassing all other checks.
 * Privilege escalation and dangerous system tools are blocked outright.
 */
const BLOCKED_BINARIES: ReadonlySet<string> = new Set([
  // Shell interpreters — allow arbitrary command execution
  'bash', 'sh', 'zsh', 'csh', 'tcsh', 'fish', 'dash', 'ksh',
  // Scripting runtimes — interpreter escape
  'python', 'python3', 'node', 'perl', 'ruby', 'php', 'lua',
  // Additional interpreters (macOS AppleScript, Tcl, Expect)
  'osascript', 'tclsh', 'wish', 'expect',
  // Privilege escalation
  'sudo', 'doas', 'pkexec', 'su', 'run0',
  // Process wrappers that bypass validation
  'env', 'xargs', 'nohup', 'strace', 'ltrace',
  // Network tools — data exfiltration / download
  'curl', 'wget', 'nc', 'ncat', 'socat', 'ssh', 'scp', 'sftp',
  // Package managers — can download and execute arbitrary code
  'npm', 'npx', 'yarn', 'pnpm', 'bun',
  // Build tools — execute arbitrary build scripts
  'make', 'cmake',
  // File manipulation — exfiltration without path validation
  'cp', 'mv', 'cat', 'head', 'tail', 'less', 'more',
  // Text processing — can read arbitrary files or transform output
  'awk', 'sed', 'tee', 'tr',
  // File search — can enumerate filesystem structure
  'find',
  // Symlink creation — can bypass filesystem tool path validation
  'ln',
  // macOS-specific — open URLs/apps, modify system prefs
  'open', 'defaults', 'dscl',
  // Scheduled execution — persistence
  'crontab', 'at',
  // Version control — can download code and execute hooks
  'git',
  // System-level destructive commands
  'mount', 'umount', 'reboot', 'shutdown', 'halt', 'poweroff',
  'kill', 'killall', 'launchctl', 'systemctl',
  // Ownership / permission escalation
  'chown', 'chgrp',
  // Low-level storage destructive
  'mkfs', 'dd',
])

/** Destructive flag patterns checked via substring match on the full command line. */
const BLOCKED_PATTERNS: readonly string[] = [
  'rm -rf /',
  'rm -r -f /',
  'rm --recursive --force /',
  'chmod 777',
  'chmod 0777',
  'chmod a+rwx',
  'chmod +s',
  'chmod u+s',
  'chmod g+s',
]

/**
 * Detects shell metacharacters that indicate injection attempts.
 * Even though execFile doesn't interpret these, we block them as defense in depth.
 * Matches: ; | ` & < > newline carriage-return null-byte $( && ||
 */
const SHELL_METACHAR_PATTERN = /[;|`&<>\n\r\0]|\$\(|&&|\|\|/

// ── Argument parsing ──────────────────────────────────────────────

interface ShellArgs {
  readonly command: string
  readonly args: readonly string[]
}

function parseArgs(raw: unknown): ShellArgs {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Arguments must be an object with "command" and "args"')
  }

  const obj = raw as Record<string, unknown>

  const command = obj['command']
  if (typeof command !== 'string' || command.trim() === '') {
    throw new Error('command must be a non-empty string')
  }

  const argsRaw = obj['args']
  if (!Array.isArray(argsRaw)) {
    throw new Error('args must be an array of strings')
  }

  const args: string[] = []
  for (const item of argsRaw) {
    if (typeof item !== 'string') {
      throw new Error('Each element in args must be a string')
    }
    args.push(item)
  }

  return { command, args }
}

// ── Validation ────────────────────────────────────────────────────

/** Validates command and args against blocked binaries, metacharacters, and patterns. */
function validateCommand(command: string, args: readonly string[]): void {
  // Reject blocked binaries by basename (handles both "sudo" and "/usr/bin/sudo")
  const basename = command.split('/').pop() ?? command
  if (BLOCKED_BINARIES.has(basename)) {
    throw new Error(`Blocked binary: ${basename}`)
  }

  // Reject shell metacharacters in the command binary name
  if (SHELL_METACHAR_PATTERN.test(command)) {
    throw new Error('Shell metacharacters are not allowed in command')
  }

  // Reject shell metacharacters in arguments (defense in depth)
  for (const arg of args) {
    if (SHELL_METACHAR_PATTERN.test(arg)) {
      throw new Error('Shell metacharacters are not allowed in arguments')
    }
  }

  // Reject blocklisted destructive flag patterns
  const fullLine = [command, ...args].join(' ')
  for (const blocked of BLOCKED_PATTERNS) {
    if (fullLine.includes(blocked)) {
      throw new Error(`Blocked command: ${blocked}`)
    }
  }
}

// ── Execution ─────────────────────────────────────────────────────

interface ShellResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

/** Runs a command via execFile (no shell interpreter). Rejects on timeout. */
function runCommand(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<ShellResult> {
  return new Promise<ShellResult>((resolve, reject) => {
    nodeExecFile(
      command,
      [...args],
      { timeout: timeoutMs, maxBuffer: MAX_BUFFER, cwd: homedir(), env: { PATH: process.env['PATH'] ?? '' } },
      (error, stdout, stderr) => {
        if (error !== null && error.killed === true) {
          reject(new Error(`Command timed out after ${timeoutMs}ms`))
          return
        }

        let exitCode = 0
        if (error !== null) {
          exitCode = typeof error.code === 'number' ? error.code : 1
        }

        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          exitCode,
        })
      },
    )
  })
}

// ── Tool factory + default instance ───────────────────────────────

export interface ShellToolOptions {
  readonly timeoutMs?: number
}

/** Creates a shell tool with configurable timeout. */
export function createShellTool(options?: ShellToolOptions): ExtendedAgentTool {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    name: 'shell',
    description:
      'Execute a command on the desktop. Runs via execFile without a shell interpreter. All executions require user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The binary/command to execute (e.g., "ls", "echo", "git")',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments to pass to the command',
        },
      },
      required: ['command', 'args'],
    },
    permissions: ['exec:shell'],
    requiresConfirmation: true,
    defaultRiskTier: 3,
    runsOn: 'desktop',
    execute: async (rawArgs: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(rawArgs)
      validateCommand(parsed.command, parsed.args)
      const result = await runCommand(parsed.command, parsed.args, timeoutMs)

      const content: TextContent = {
        type: 'text',
        text: JSON.stringify(result),
      }
      return { content: [content] }
    },
  }
}

/** Default shell tool instance with 30-second timeout. */
export const shellTool: ExtendedAgentTool = createShellTool()
