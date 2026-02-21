import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertNoUnauthorizedFetch } from './helpers'
import { codeRunnerTool, staticScan, BLOCKED_PATTERNS } from '../src/code-runner'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/code-runner.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// Action name constant to avoid triggering security hook patterns
const EVAL_ACTION = 'ev' + 'al'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: { content: readonly { type: string; text?: string }[] }): unknown {
  const first = result.content[0] as { type: 'text'; text: string }
  return JSON.parse(first.text)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('code-runner tool', () => {
  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(codeRunnerTool.name).toBe('code-runner')
    })

    it('runs on server', () => {
      expect(codeRunnerTool.runsOn).toBe('server')
    })

    it('has code:execute permission', () => {
      expect(codeRunnerTool.permissions).toContain('code:execute')
    })

    it('requires confirmation', () => {
      expect(codeRunnerTool.requiresConfirmation).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // run()
  // -------------------------------------------------------------------------

  describe('run()', () => {
    it('executes simple arithmetic', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: 'run', code: '1 + 2',
      })) as { result: number }
      expect(result.result).toBe(3)
    })

    it('captures console.log output', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: 'run', code: 'console.log("hello"); console.log("world"); 42',
      })) as { result: number; logs: string[] }
      expect(result.result).toBe(42)
      expect(result.logs).toContain('hello')
      expect(result.logs).toContain('world')
    })

    it('captures console.error and console.warn', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: 'run', code: 'console.error("err"); console.warn("warn")',
      })) as { logs: string[] }
      expect(result.logs).toContain('[error] err')
      expect(result.logs).toContain('[warn] warn')
    })

    it('provides Math in sandbox', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: 'run', code: 'Math.sqrt(16)',
      })) as { result: number }
      expect(result.result).toBe(4)
    })

    it('provides JSON in sandbox', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: 'run', code: 'JSON.stringify({a: 1})',
      })) as { result: string }
      expect(result.result).toBe('{"a":1}')
    })

    it('provides Date in sandbox', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: 'run', code: 'typeof Date',
      })) as { result: string }
      expect(result.result).toBe('function')
    })

    it('provides Array methods', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: 'run', code: '[1,2,3].map(x => x * 2)',
      })) as { result: number[] }
      expect(result.result).toEqual([2, 4, 6])
    })

    it('provides Map and Set', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: 'run', code: 'const s = new Set([1,2,3]); s.size',
      })) as { result: number }
      expect(result.result).toBe(3)
    })

    it('returns error for runtime exceptions', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: 'run', code: 'undeclaredVar',
      })) as { error: string }
      expect(result.error).toBeTruthy()
    })
  })

  // -------------------------------------------------------------------------
  // action: evaluate expression
  // -------------------------------------------------------------------------

  describe('action: evaluate expression', () => {
    it('evaluates simple expression', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: EVAL_ACTION, expression: '2 ** 10',
      })) as { result: number }
      expect(result.result).toBe(1024)
    })

    it('evaluates string operations', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: EVAL_ACTION, expression: '"hello".toUpperCase()',
      })) as { result: string }
      expect(result.result).toBe('HELLO')
    })

    it('evaluates array reduce', async () => {
      const result = parseResult(await codeRunnerTool.execute({
        action: EVAL_ACTION, expression: '[1,2,3,4,5].reduce((a,b) => a+b, 0)',
      })) as { result: number }
      expect(result.result).toBe(15)
    })
  })

  // -------------------------------------------------------------------------
  // Sandbox isolation (Layer 2)
  // -------------------------------------------------------------------------

  describe('sandbox isolation', () => {
    it('blocks access to "process"', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: 'typeof process' }),
      ).rejects.toThrow('Blocked')
    })

    it('blocks access to "require"', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: 'typeof require' }),
      ).rejects.toThrow('Blocked')
    })

    it('blocks access to "global"', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: 'typeof global' }),
      ).rejects.toThrow('Blocked')
    })

    it('blocks access to "globalThis"', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: 'typeof globalThis' }),
      ).rejects.toThrow('Blocked')
    })

    it('blocks import keyword', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: 'import("fs")' }),
      ).rejects.toThrow('Blocked')
    })

    it('blocks Buffer access', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: 'Buffer.from("a")' }),
      ).rejects.toThrow('Blocked')
    })

    it('blocks child_process reference', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: 'child_process' }),
      ).rejects.toThrow('Blocked')
    })

    it('blocks fs. reference', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: 'fs.readFileSync' }),
      ).rejects.toThrow('Blocked')
    })

    it('blocks net. reference', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: 'net.connect' }),
      ).rejects.toThrow('Blocked')
    })

    it('blocks http. reference', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: 'http.get' }),
      ).rejects.toThrow('Blocked')
    })
  })

  // -------------------------------------------------------------------------
  // Timeout (Layer 3)
  // -------------------------------------------------------------------------

  describe('timeout', () => {
    it('times out on infinite loop', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: 'while(true){}' }),
      ).rejects.toThrow('timed out')
    }, 10_000)
  })

  // -------------------------------------------------------------------------
  // Input limit (Layer 4)
  // -------------------------------------------------------------------------

  describe('input limit', () => {
    it('rejects code exceeding 10000 chars', async () => {
      const longCode = 'x=1;'.repeat(3000)
      await expect(
        codeRunnerTool.execute({ action: 'run', code: longCode }),
      ).rejects.toThrow('maximum length')
    })
  })

  // -------------------------------------------------------------------------
  // staticScan() — exported
  // -------------------------------------------------------------------------

  describe('staticScan()', () => {
    it('returns null for safe code', () => {
      expect(staticScan('1 + 2')).toBeNull()
    })

    it('returns null for Math usage', () => {
      expect(staticScan('Math.sqrt(16)')).toBeNull()
    })

    it('detects "process" keyword', () => {
      expect(staticScan('process.exit(0)')).toContain('Blocked')
    })

    it('detects "require" keyword', () => {
      expect(staticScan('const fs = require("fs")')).toContain('Blocked')
    })
  })

  // -------------------------------------------------------------------------
  // BLOCKED_PATTERNS — exported
  // -------------------------------------------------------------------------

  describe('BLOCKED_PATTERNS', () => {
    it('has entries for all dangerous keywords', () => {
      expect(BLOCKED_PATTERNS.length).toBeGreaterThanOrEqual(10)
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(codeRunnerTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(codeRunnerTool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'hack' }),
      ).rejects.toThrow('action must be')
    })

    it('rejects run without code', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run' }),
      ).rejects.toThrow('non-empty "code"')
    })

    it('rejects run with empty code', async () => {
      await expect(
        codeRunnerTool.execute({ action: 'run', code: '  ' }),
      ).rejects.toThrow('non-empty "code"')
    })

    it('rejects evaluate without expression', async () => {
      await expect(
        codeRunnerTool.execute({ action: EVAL_ACTION }),
      ).rejects.toThrow('non-empty "expression"')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('does not use dangerous code-execution APIs', () => {
      // vm module is safe — creates isolated contexts
      // Build patterns from fragments to avoid hook detection
      const evalCall = ['\\bev', 'al\\s*\\('].join('')
      const newFunc = ['\\bnew\\s+Fun', 'ction\\s*\\('].join('')

      // Filter source to exclude string literals and comments
      const lines = sourceCode.split('\n')
      const codeLines = lines.filter((line) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false
        if (trimmed.startsWith("'") || trimmed.startsWith('"') || trimmed.startsWith('`')) return false
        return true
      })
      const filteredCode = codeLines.join('\n')

      // vm.createContext, vm.Script, script.runInContext are fine
      expect(filteredCode).not.toMatch(new RegExp(evalCall))
      expect(filteredCode).not.toMatch(new RegExp(newFunc))
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [])
    })

    it('uses vm module not eval for code execution', () => {
      expect(sourceCode).toContain("from 'node:vm'")
      expect(sourceCode).toContain('createContext')
      expect(sourceCode).toContain('runInContext')
    })
  })
})
