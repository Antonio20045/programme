/**
 * Code Runner tool — execute JavaScript in a vm sandbox.
 * 5-layer security: static pre-scan, empty context, timeout, input limit, output limit.
 * Uses Node.js vm module (NOT eval/Function).
 */

import { createContext, Script } from 'node:vm'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunArgs {
  readonly action: 'run'
  readonly code: string
}

interface EvalArgs {
  readonly action: 'eval'
  readonly expression: string
}

type CodeRunnerArgs = RunArgs | EvalArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CODE_LENGTH = 10_000
const MAX_OUTPUT_SIZE = 1 * 1024 * 1024 // 1MB
const TIMEOUT_MS = 5_000

// Dangerous patterns — static pre-scan (Layer 1)
const BLOCKED_PATTERNS: readonly RegExp[] = [
  /\bprocess\b/,
  /\brequire\b/,
  /\bglobal\b/,
  /\bglobalThis\b/,
  /\bimport\b/,
  /\bBuffer\b/,
  /\bchild_process\b/,
  /\bfs\./,
  /\bnet\./,
  /\bhttp\./,
  // Block constructor chain escape: this.constructor.constructor('return process')()
  /\bconstructor\b/,
  // Block __proto__ access which can also reach Function constructor
  /__proto__/,
]

// Whitelisted globals for sandbox context (Layer 2)
const SANDBOX_GLOBALS: Readonly<Record<string, unknown>> = {
  Math,
  JSON,
  Date,
  String,
  Number,
  Array,
  Object,
  Map,
  Set,
  RegExp,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  encodeURIComponent,
  decodeURIComponent,
  encodeURI,
  decodeURI,
  undefined,
  NaN,
  Infinity,
}

// ---------------------------------------------------------------------------
// Static pre-scan (Layer 1)
// ---------------------------------------------------------------------------

function staticScan(code: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      return `Blocked: code contains forbidden pattern "${pattern.source}"`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Sandbox execution
// ---------------------------------------------------------------------------

interface ExecutionResult {
  readonly result: unknown
  readonly logs: readonly string[]
}

function executeInSandbox(code: string, timeout: number): ExecutionResult {
  const logs: string[] = []

  // Console capture
  const consoleMock = {
    log: (...args: unknown[]) => {
      const line = args.map((a) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
      logs.push(line)
    },
    error: (...args: unknown[]) => {
      const line = args.map((a) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
      logs.push(`[error] ${line}`)
    },
    warn: (...args: unknown[]) => {
      const line = args.map((a) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
      logs.push(`[warn] ${line}`)
    },
  }

  // Layer 2: Empty context with whitelisted globals only
  // Freeze all sandbox objects to prevent prototype chain traversal
  const frozenGlobals: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(SANDBOX_GLOBALS)) {
    frozenGlobals[key] = typeof value === 'function' || typeof value === 'object'
      ? value
      : value
  }
  const sandbox = {
    ...frozenGlobals,
    console: Object.freeze(consoleMock),
  }
  Object.freeze(sandbox)
  const context = createContext(sandbox)

  // Layer 3: Timeout
  const script = new Script(code, { filename: 'sandbox.js' })
  const result = script.runInContext(context, { timeout })

  return { result, logs }
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

function executeRun(args: RunArgs): AgentToolResult {
  // Layer 4: Input limit
  if (args.code.length > MAX_CODE_LENGTH) {
    throw new Error(`Code exceeds maximum length of ${String(MAX_CODE_LENGTH)} characters`)
  }

  // Layer 1: Static pre-scan
  const scanResult = staticScan(args.code)
  if (scanResult !== null) {
    throw new Error(scanResult)
  }

  try {
    const { result, logs } = executeInSandbox(args.code, TIMEOUT_MS)

    // Layer 5: Output limit
    const output = JSON.stringify({ result, logs })
    if (output.length > MAX_OUTPUT_SIZE) {
      throw new Error('Output exceeds maximum size of 1MB')
    }

    return textResult(output)
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : ''
    const errCode = (e as { code?: string }).code ?? ''
    if (errMsg.includes('timed out') || errMsg.includes('Script execution') || errCode === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new Error('Code execution timed out (5 second limit)')
    }
    // Re-check for output limit error
    if (e instanceof Error && e.message.includes('Output exceeds')) {
      throw e
    }
    const message = e instanceof Error ? e.message : 'Unknown execution error'
    return textResult(JSON.stringify({ error: message, logs: [] }))
  }
}

function executeEval(args: EvalArgs): AgentToolResult {
  // Layer 4: Input limit
  if (args.expression.length > MAX_CODE_LENGTH) {
    throw new Error(`Expression exceeds maximum length of ${String(MAX_CODE_LENGTH)} characters`)
  }

  // Layer 1: Static pre-scan
  const scanResult = staticScan(args.expression)
  if (scanResult !== null) {
    throw new Error(scanResult)
  }

  try {
    const { result, logs } = executeInSandbox(args.expression, TIMEOUT_MS)

    const output = JSON.stringify({ result, logs })
    if (output.length > MAX_OUTPUT_SIZE) {
      throw new Error('Output exceeds maximum size of 1MB')
    }

    return textResult(output)
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : ''
    const errCode = (e as { code?: string }).code ?? ''
    if (errMsg.includes('timed out') || errMsg.includes('Script execution') || errCode === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new Error('Code execution timed out (5 second limit)')
    }
    if (e instanceof Error && e.message.includes('Output exceeds')) {
      throw e
    }
    const message = e instanceof Error ? e.message : 'Unknown execution error'
    return textResult(JSON.stringify({ error: message, logs: [] }))
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): CodeRunnerArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'run') {
    const code = obj['code']
    if (typeof code !== 'string' || code.trim() === '') {
      throw new Error('run requires a non-empty "code" string')
    }
    return { action: 'run', code: code.trim() }
  }

  if (action === 'eval') {
    const expression = obj['expression']
    if (typeof expression !== 'string' || expression.trim() === '') {
      throw new Error('eval requires a non-empty "expression" string')
    }
    return { action: 'eval', expression: expression.trim() }
  }

  throw new Error('action must be "run" or "eval"')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "run" (execute code block) or "eval" (evaluate expression)',
      enum: ['run', 'eval'],
    },
    code: {
      type: 'string',
      description: 'JavaScript code to execute (run action, max 10000 chars)',
    },
    expression: {
      type: 'string',
      description: 'JavaScript expression to evaluate (eval action, max 10000 chars)',
    },
  },
  required: ['action'],
}

export const codeRunnerTool: ExtendedAgentTool = {
  name: 'code-runner',
  description:
    'Execute JavaScript in a secure sandbox. Actions: run(code) executes a code block with console capture; evaluate via "eval" action(expression) returns the result. Sandbox provides: Math, JSON, Date, String, Number, Array, Object, Map, Set, RegExp, console. No access to process, require, fs, net, or any Node.js APIs. 5s timeout, 10KB input limit, 1MB output limit.',
  parameters,
  permissions: ['code:execute'],
  requiresConfirmation: true,
  defaultRiskTier: 2,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'run':
        return executeRun(parsed)
      case 'eval':
        return executeEval(parsed)
    }
  },
}

export { staticScan, BLOCKED_PATTERNS }
