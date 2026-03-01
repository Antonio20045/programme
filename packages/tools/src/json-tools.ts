/**
 * JSON Tools — validate, format, query, merge, repair JSON data.
 * Own JSONPath mini-parser for queries. No external dependencies.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidateArgs {
  readonly action: 'validate'
  readonly json: string
}

interface FormatArgs {
  readonly action: 'format'
  readonly json: string
  readonly indent?: number
}

interface QueryArgs {
  readonly action: 'query'
  readonly json: string
  readonly path: string
}

interface MergeArgs {
  readonly action: 'merge'
  readonly json1: string
  readonly json2: string
}

interface RepairArgs {
  readonly action: 'repair'
  readonly json: string
}

type JsonToolsArgs = ValidateArgs | FormatArgs | QueryArgs | MergeArgs | RepairArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_INPUT_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_QUERY_DEPTH = 20

// ---------------------------------------------------------------------------
// JSONPath Mini-Parser
// ---------------------------------------------------------------------------

type PathSegmentType = 'key' | 'index' | 'wildcard' | 'recursive'

interface PathSegment {
  readonly type: PathSegmentType
  readonly value: string
}

function parsePath(path: string): PathSegment[] {
  if (!path.startsWith('$')) {
    throw new Error('JSONPath must start with "$"')
  }

  const segments: PathSegment[] = []
  let i = 1 // skip '$'

  while (i < path.length) {
    // Recursive descent: ..
    if (path[i] === '.' && path[i + 1] === '.') {
      i += 2
      // Read key after ..
      let key = ''
      while (i < path.length && path[i] !== '.' && path[i] !== '[') {
        key += path[i]
        i++
      }
      if (key === '') {
        throw new Error('Expected key after ".."')
      }
      segments.push({ type: 'recursive', value: key })
      continue
    }

    // Dot notation: .key
    if (path[i] === '.') {
      i++ // skip '.'
      let key = ''
      while (i < path.length && path[i] !== '.' && path[i] !== '[') {
        key += path[i]
        i++
      }
      if (key === '*') {
        segments.push({ type: 'wildcard', value: '*' })
      } else if (key === '') {
        throw new Error('Expected key after "."')
      } else {
        segments.push({ type: 'key', value: key })
      }
      continue
    }

    // Bracket notation: [0], [*], ['key']
    if (path[i] === '[') {
      i++ // skip '['
      if (path[i] === '*') {
        segments.push({ type: 'wildcard', value: '*' })
        i++ // skip '*'
      } else if (path[i] === "'" || path[i] === '"') {
        const quote = path[i]
        i++ // skip opening quote
        let key = ''
        while (i < path.length && path[i] !== quote) {
          key += path[i]
          i++
        }
        i++ // skip closing quote
        segments.push({ type: 'key', value: key })
      } else {
        // Numeric index
        let num = ''
        while (i < path.length && path[i] !== ']') {
          num += path[i]
          i++
        }
        const index = Number(num)
        if (!Number.isInteger(index) || index < 0) {
          throw new Error(`Invalid array index: ${num}`)
        }
        segments.push({ type: 'index', value: num })
      }
      if (path[i] === ']') {
        i++ // skip ']'
      } else {
        throw new Error('Expected "]"')
      }
      continue
    }

    throw new Error(`Unexpected character in JSONPath at position ${String(i)}: "${path[i] as string}"`)
  }

  return segments
}

function queryJson(data: unknown, segments: readonly PathSegment[], depth: number = 0): unknown[] {
  if (depth > MAX_QUERY_DEPTH) {
    throw new Error(`JSONPath query exceeded maximum depth of ${String(MAX_QUERY_DEPTH)}`)
  }

  if (segments.length === 0) {
    return [data]
  }

  const [segment, ...rest] = segments as [PathSegment, ...PathSegment[]]
  const results: unknown[] = []

  switch (segment.type) {
    case 'key': {
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>
        if (segment.value in obj) {
          results.push(...queryJson(obj[segment.value], rest, depth + 1))
        }
      }
      break
    }
    case 'index': {
      if (Array.isArray(data)) {
        const idx = Number(segment.value)
        if (idx >= 0 && idx < data.length) {
          results.push(...queryJson(data[idx], rest, depth + 1))
        }
      }
      break
    }
    case 'wildcard': {
      if (Array.isArray(data)) {
        for (const item of data) {
          results.push(...queryJson(item, rest, depth + 1))
        }
      } else if (typeof data === 'object' && data !== null) {
        for (const value of Object.values(data)) {
          results.push(...queryJson(value, rest, depth + 1))
        }
      }
      break
    }
    case 'recursive': {
      // Search for key recursively
      const searchKey = segment.value
      const recurse = (current: unknown, d: number): void => {
        if (d > MAX_QUERY_DEPTH) return
        if (typeof current === 'object' && current !== null) {
          if (!Array.isArray(current)) {
            const obj = current as Record<string, unknown>
            if (searchKey in obj) {
              results.push(...queryJson(obj[searchKey], rest, d + 1))
            }
            for (const value of Object.values(obj)) {
              recurse(value, d + 1)
            }
          } else {
            for (const item of current) {
              recurse(item, d + 1)
            }
          }
        }
      }
      recurse(data, depth)
      break
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Repair logic
// ---------------------------------------------------------------------------

function repairJson(input: string): string {
  let s = input.trim()

  // 1. Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1')

  // 2. Single quotes → double quotes (but not inside strings)
  s = s.replace(/'/g, '"')

  // 3. Unquoted keys → quoted keys
  s = s.replace(/(\{|,)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":')

  // 4. Fix missing closing brackets
  let openBraces = 0
  let openBrackets = 0
  let inString = false
  let escaped = false

  for (const ch of s) {
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') openBraces++
    if (ch === '}') openBraces--
    if (ch === '[') openBrackets++
    if (ch === ']') openBrackets--
  }

  while (openBrackets > 0) {
    s += ']'
    openBrackets--
  }
  while (openBraces > 0) {
    s += '}'
    openBraces--
  }

  return s
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateInputSize(input: string, label: string): void {
  if (input.length > MAX_INPUT_SIZE) {
    throw new Error(`${label} exceeds maximum size of 5MB`)
  }
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

function executeValidate(args: ValidateArgs): AgentToolResult {
  validateInputSize(args.json, 'JSON input')
  try {
    JSON.parse(args.json)
    return textResult(JSON.stringify({ valid: true }))
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown parse error'
    return textResult(JSON.stringify({ valid: false, error: message }))
  }
}

function executeFormat(args: FormatArgs): AgentToolResult {
  validateInputSize(args.json, 'JSON input')
  const indent = args.indent ?? 2
  if (indent < 0 || indent > 8) {
    throw new Error('indent must be between 0 and 8')
  }
  const parsed = JSON.parse(args.json) as unknown
  const formatted = JSON.stringify(parsed, null, indent)
  return textResult(JSON.stringify({ formatted }))
}

function executeQuery(args: QueryArgs): AgentToolResult {
  validateInputSize(args.json, 'JSON input')
  const data = JSON.parse(args.json) as unknown
  const segments = parsePath(args.path)
  const results = queryJson(data, segments)
  return textResult(JSON.stringify({ path: args.path, results, count: results.length }))
}

function executeMerge(args: MergeArgs): AgentToolResult {
  validateInputSize(args.json1, 'First JSON input')
  validateInputSize(args.json2, 'Second JSON input')
  const obj1 = JSON.parse(args.json1) as unknown
  const obj2 = JSON.parse(args.json2) as unknown

  if (typeof obj1 !== 'object' || obj1 === null || Array.isArray(obj1)) {
    throw new Error('json1 must be a JSON object (not array or primitive)')
  }
  if (typeof obj2 !== 'object' || obj2 === null || Array.isArray(obj2)) {
    throw new Error('json2 must be a JSON object (not array or primitive)')
  }

  const merged = { ...obj1 as Record<string, unknown>, ...obj2 as Record<string, unknown> }
  return textResult(JSON.stringify({ merged }))
}

function executeRepair(args: RepairArgs): AgentToolResult {
  validateInputSize(args.json, 'JSON input')
  const repaired = repairJson(args.json)
  try {
    const parsed = JSON.parse(repaired) as unknown
    return textResult(JSON.stringify({ repaired, parsed, success: true }))
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return textResult(JSON.stringify({ repaired, success: false, error: message }))
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): JsonToolsArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'validate') {
    const json = obj['json']
    if (typeof json !== 'string') {
      throw new Error('validate requires a "json" string')
    }
    return { action: 'validate', json }
  }

  if (action === 'format') {
    const json = obj['json']
    if (typeof json !== 'string') {
      throw new Error('format requires a "json" string')
    }
    const indent = typeof obj['indent'] === 'number' ? obj['indent'] : undefined
    return { action: 'format', json, indent }
  }

  if (action === 'query') {
    const json = obj['json']
    const path = obj['path']
    if (typeof json !== 'string') {
      throw new Error('query requires a "json" string')
    }
    if (typeof path !== 'string' || path.trim() === '') {
      throw new Error('query requires a non-empty "path" string')
    }
    return { action: 'query', json, path: path.trim() }
  }

  if (action === 'merge') {
    const json1 = obj['json1']
    const json2 = obj['json2']
    if (typeof json1 !== 'string') {
      throw new Error('merge requires a "json1" string')
    }
    if (typeof json2 !== 'string') {
      throw new Error('merge requires a "json2" string')
    }
    return { action: 'merge', json1, json2 }
  }

  if (action === 'repair') {
    const json = obj['json']
    if (typeof json !== 'string') {
      throw new Error('repair requires a "json" string')
    }
    return { action: 'repair', json }
  }

  throw new Error('action must be "validate", "format", "query", "merge", or "repair"')
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

const toolParameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "validate", "format", "query", "merge", or "repair"',
      enum: ['validate', 'format', 'query', 'merge', 'repair'],
    },
    json: {
      type: 'string',
      description: 'JSON string to process',
    },
    json1: {
      type: 'string',
      description: 'First JSON object for merge',
    },
    json2: {
      type: 'string',
      description: 'Second JSON object for merge (overrides json1 on conflicts)',
    },
    path: {
      type: 'string',
      description: 'JSONPath expression (e.g. $.store.books[0].title, $..author, $[*].name)',
    },
    indent: {
      type: 'number',
      description: 'Indentation spaces for format (default: 2, max: 8)',
    },
  },
  required: ['action'],
}

export const jsonToolsTool: ExtendedAgentTool = {
  name: 'json-tools',
  description:
    'JSON utilities. Actions: validate(json) checks syntax; format(json, indent?) pretty-prints; query(json, path) searches with JSONPath ($.key, $[0], $[*], $..key); merge(json1, json2) shallow merges objects; repair(json) fixes common issues (trailing commas, single quotes, unquoted keys, missing brackets).',
  parameters: toolParameters,
  permissions: [],
  requiresConfirmation: false,
  defaultRiskTier: 0,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'validate':
        return executeValidate(parsed)
      case 'format':
        return executeFormat(parsed)
      case 'query':
        return executeQuery(parsed)
      case 'merge':
        return executeMerge(parsed)
      case 'repair':
        return executeRepair(parsed)
    }
  },
}

export { parsePath, queryJson, repairJson }
