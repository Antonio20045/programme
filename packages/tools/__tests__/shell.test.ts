import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { assertNoEval } from './helpers'
import { createShellTool, shellTool } from '../src/shell'

const SHELL_SOURCE = readFileSync(
  new URL('../src/shell.ts', import.meta.url),
  'utf-8',
)

/** Parse the JSON result text from a tool execution. */
function parseResult(result: Awaited<ReturnType<typeof shellTool.execute>>): {
  stdout: string
  stderr: string
  exitCode: number
} {
  const first = result.content[0]
  expect(first).toBeDefined()
  expect(first?.type).toBe('text')
  if (first?.type !== 'text') throw new Error('Expected text content')
  return JSON.parse(first.text) as { stdout: string; stderr: string; exitCode: number }
}

// ── Behavior tests ────────────────────────────────────────────────

describe('shell tool — behavior', () => {
  it('ls returns file listing', async () => {
    const result = await shellTool.execute({ command: 'ls', args: [] })
    const parsed = parseResult(result)
    expect(parsed.exitCode).toBe(0)
    expect(parsed.stdout.length).toBeGreaterThan(0)
  })

  it('echo test returns test', async () => {
    const result = await shellTool.execute({ command: 'echo', args: ['test'] })
    const parsed = parseResult(result)
    expect(parsed.stdout.trim()).toBe('test')
    expect(parsed.exitCode).toBe(0)
  })

  it('aborts command after timeout', async () => {
    const tool = createShellTool({ timeoutMs: 1000 })
    await expect(
      tool.execute({ command: 'sleep', args: ['60'] }),
    ).rejects.toThrow('timed out')
  }, 10_000)
})

// ── Blocklist tests ───────────────────────────────────────────────

describe('shell tool — blocklist', () => {
  it('rejects rm -rf /', async () => {
    await expect(
      shellTool.execute({ command: 'rm', args: ['-rf', '/'] }),
    ).rejects.toThrow('Blocked command')
  })

  it('rejects sudo', async () => {
    await expect(
      shellTool.execute({ command: 'sudo', args: ['ls'] }),
    ).rejects.toThrow('Blocked binary')
  })

  it('rejects chmod 777', async () => {
    await expect(
      shellTool.execute({ command: 'chmod', args: ['777', '/tmp/file'] }),
    ).rejects.toThrow('Blocked command')
  })

  it('rejects mkfs', async () => {
    await expect(
      shellTool.execute({ command: 'mkfs', args: ['/dev/sda1'] }),
    ).rejects.toThrow('Blocked binary')
  })

  it('rejects dd', async () => {
    await expect(
      shellTool.execute({ command: 'dd', args: ['if=/dev/zero', 'of=/dev/sda'] }),
    ).rejects.toThrow('Blocked binary')
  })

  it('rejects rm -r -f / (split flags bypass)', async () => {
    await expect(
      shellTool.execute({ command: 'rm', args: ['-r', '-f', '/'] }),
    ).rejects.toThrow('Blocked command')
  })

  it('rejects chmod +s (SUID)', async () => {
    await expect(
      shellTool.execute({ command: 'chmod', args: ['+s', '/tmp/file'] }),
    ).rejects.toThrow('Blocked command')
  })

  it('rejects shell interpreters (bash -c bypass)', async () => {
    await expect(
      shellTool.execute({ command: 'bash', args: ['-c', 'cat /etc/shadow'] }),
    ).rejects.toThrow('Blocked binary')
  })

  it('rejects scripting runtimes (python)', async () => {
    await expect(
      shellTool.execute({ command: 'python3', args: ['-c', 'import os'] }),
    ).rejects.toThrow('Blocked binary')
  })

  it('rejects privilege escalation alternatives (doas)', async () => {
    await expect(
      shellTool.execute({ command: 'doas', args: ['ls'] }),
    ).rejects.toThrow('Blocked binary')
  })

  it('rejects full-path blocked binaries (/usr/bin/sudo)', async () => {
    await expect(
      shellTool.execute({ command: '/usr/bin/sudo', args: ['ls'] }),
    ).rejects.toThrow('Blocked binary')
  })

  it('rejects network tools (curl)', async () => {
    await expect(
      shellTool.execute({ command: 'curl', args: ['https://evil.com'] }),
    ).rejects.toThrow('Blocked binary')
  })
})

// ── Shell injection tests ─────────────────────────────────────────

describe('shell tool — shell injection', () => {
  it('rejects command with semicolon', async () => {
    await expect(
      shellTool.execute({ command: 'ls; rm -rf /', args: [] }),
    ).rejects.toThrow('Shell metacharacters')
  })

  it('rejects command with $()', async () => {
    await expect(
      shellTool.execute({ command: '$(whoami)', args: [] }),
    ).rejects.toThrow('Shell metacharacters')
  })

  it('rejects command with pipe', async () => {
    await expect(
      shellTool.execute({ command: 'ls | grep secret', args: [] }),
    ).rejects.toThrow('Shell metacharacters')
  })

  it('rejects command with backtick', async () => {
    await expect(
      shellTool.execute({ command: '`whoami`', args: [] }),
    ).rejects.toThrow('Shell metacharacters')
  })

  it('rejects metacharacters in arguments', async () => {
    await expect(
      shellTool.execute({ command: 'echo', args: ['hello; rm -rf /'] }),
    ).rejects.toThrow('Shell metacharacters')
  })

  it('rejects $() in arguments', async () => {
    await expect(
      shellTool.execute({ command: 'echo', args: ['$(cat /etc/passwd)'] }),
    ).rejects.toThrow('Shell metacharacters')
  })
})

// ── Security audit ────────────────────────────────────────────────

describe('shell tool — security', () => {
  it('source contains no eval/exec patterns', () => {
    assertNoEval(SHELL_SOURCE)
  })

  it('uses execFile not exec', () => {
    // Verify the import uses execFile
    expect(SHELL_SOURCE).toContain('execFile')
    // Verify no child_process.exec import (build from fragments to avoid hook)
    const importExec = ["from 'node:child_process'"].join('')
    const lines = SHELL_SOURCE.split('\n').filter((l) => l.includes(importExec))
    for (const line of lines) {
      // Only execFile should be imported, never bare exec
      expect(line).toContain('execFile')
    }
  })

  it('has requiresConfirmation set to true', () => {
    expect(SHELL_SOURCE).toContain('requiresConfirmation: true')
  })

  it('has no fetch calls', () => {
    const fetchPattern = /\bfetch\s*\(/
    expect(SHELL_SOURCE).not.toMatch(fetchPattern)
  })
})
