/**
 * Calculator tool — arithmetic expressions, unit conversion, currency conversion.
 * Implements a recursive-descent parser for safe expression handling.
 * No code-execution APIs — all parsing is done by hand.
 *
 * API for currency: https://api.exchangerate.host/convert
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalculateArgs {
  readonly action: 'calculate'
  readonly expression: string
}

interface ConvertArgs {
  readonly action: 'convert'
  readonly value: number
  readonly from: string
  readonly to: string
}

interface CurrencyArgs {
  readonly action: 'currency'
  readonly amount: number
  readonly from: string
  readonly to: string
}

type CalculatorArgs = CalculateArgs | ConvertArgs | CurrencyArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EXPRESSION_LENGTH = 1000
const CURRENCY_TIMEOUT_MS = 10_000
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(['api.exchangerate.host'])

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType =
  | 'NUMBER'
  | 'OPERATOR'
  | 'FUNCTION'
  | 'CONSTANT'
  | 'LPAREN'
  | 'RPAREN'

interface Token {
  readonly type: TokenType
  readonly value: string
}

const FUNCTIONS: ReadonlySet<string> = new Set([
  'sqrt', 'sin', 'cos', 'tan', 'log', 'ln', 'abs', 'ceil', 'floor', 'round',
])

const CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  e: Math.E,
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const src = input.replace(/\s+/g, '')

  while (i < src.length) {
    const ch = src[i] as string

    // Number (integers, decimals)
    if (/\d/.test(ch) || (ch === '.' && i + 1 < src.length && /\d/.test(src[i + 1] as string))) {
      let num = ''
      while (i < src.length && (/\d/.test(src[i] as string) || src[i] === '.')) {
        num += src[i] as string
        i++
      }
      tokens.push({ type: 'NUMBER', value: num })
      continue
    }

    // Operator
    if ('+-*/%^'.includes(ch)) {
      tokens.push({ type: 'OPERATOR', value: ch })
      i++
      continue
    }

    // Parentheses
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' })
      i++
      continue
    }

    // Identifier (function or constant)
    if (/[a-z]/i.test(ch)) {
      let ident = ''
      while (i < src.length && /[a-z]/i.test(src[i] as string)) {
        ident += src[i] as string
        i++
      }
      const lower = ident.toLowerCase()
      if (FUNCTIONS.has(lower)) {
        tokens.push({ type: 'FUNCTION', value: lower })
      } else if (lower in CONSTANTS) {
        tokens.push({ type: 'CONSTANT', value: lower })
      } else {
        throw new Error(`Unknown identifier: ${ident}`)
      }
      continue
    }

    throw new Error(`Unexpected character: ${ch}`)
  }

  return tokens
}

// ---------------------------------------------------------------------------
// Recursive-Descent Parser
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0
  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number {
    const result = this.additive()
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token: ${(this.tokens[this.pos] as Token).value}`)
    }
    return result
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private consume(expected?: string): Token {
    const tok = this.tokens[this.pos]
    if (tok === undefined) {
      throw new Error('Unexpected end of expression')
    }
    if (expected !== undefined && tok.value !== expected) {
      throw new Error(`Expected "${expected}", got "${tok.value}"`)
    }
    this.pos++
    return tok
  }

  private additive(): number {
    let left = this.multiplicative()
    while (this.peek()?.type === 'OPERATOR' && (this.peek()?.value === '+' || this.peek()?.value === '-')) {
      const op = this.consume().value
      const right = this.multiplicative()
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  private multiplicative(): number {
    let left = this.power()
    while (this.peek()?.type === 'OPERATOR' && (this.peek()?.value === '*' || this.peek()?.value === '/' || this.peek()?.value === '%')) {
      const op = this.consume().value
      const right = this.power()
      if (op === '/') {
        if (right === 0) throw new Error('Division by zero')
        left = left / right
      } else if (op === '%') {
        if (right === 0) throw new Error('Division by zero')
        left = left % right
      } else {
        left = left * right
      }
    }
    return left
  }

  private power(): number {
    const base = this.unary()
    if (this.peek()?.type === 'OPERATOR' && this.peek()?.value === '^') {
      this.consume()
      const exponent = this.power() // right-associative
      return Math.pow(base, exponent)
    }
    return base
  }

  private unary(): number {
    if (this.peek()?.type === 'OPERATOR' && this.peek()?.value === '-') {
      this.consume()
      return -this.unary()
    }
    if (this.peek()?.type === 'OPERATOR' && this.peek()?.value === '+') {
      this.consume()
      return this.unary()
    }
    return this.functionCall()
  }

  private functionCall(): number {
    if (this.peek()?.type === 'FUNCTION') {
      const fn = this.consume().value
      this.consume('(')
      const arg = this.additive()
      this.consume(')')
      return applyFunction(fn, arg)
    }
    return this.primary()
  }

  private primary(): number {
    const tok = this.peek()
    if (tok === undefined) {
      throw new Error('Unexpected end of expression')
    }

    if (tok.type === 'NUMBER') {
      this.consume()
      const num = Number(tok.value)
      if (isNaN(num)) throw new Error(`Invalid number: ${tok.value}`)
      return num
    }

    if (tok.type === 'CONSTANT') {
      this.consume()
      const val = CONSTANTS[tok.value]
      if (val === undefined) throw new Error(`Unknown constant: ${tok.value}`)
      return val
    }

    if (tok.type === 'LPAREN') {
      this.consume('(')
      const result = this.additive()
      this.consume(')')
      return result
    }

    throw new Error(`Unexpected token: ${tok.value}`)
  }
}

function applyFunction(name: string, arg: number): number {
  switch (name) {
    case 'sqrt': return Math.sqrt(arg)
    case 'sin': return Math.sin(arg)
    case 'cos': return Math.cos(arg)
    case 'tan': return Math.tan(arg)
    case 'log': return Math.log10(arg)
    case 'ln': return Math.log(arg)
    case 'abs': return Math.abs(arg)
    case 'ceil': return Math.ceil(arg)
    case 'floor': return Math.floor(arg)
    case 'round': return Math.round(arg)
    default: throw new Error(`Unknown function: ${name}`)
  }
}

function evaluate(expression: string): number {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Expression too long (max ${String(MAX_EXPRESSION_LENGTH)} characters)`)
  }
  const tokens = tokenize(expression)
  if (tokens.length === 0) {
    throw new Error('Empty expression')
  }
  const parser = new Parser(tokens)
  return parser.parse()
}

// ---------------------------------------------------------------------------
// Unit Conversion
// ---------------------------------------------------------------------------

interface UnitCategory {
  readonly units: Readonly<Record<string, number>>
}

interface TemperatureConversion {
  readonly convert: (value: number, from: string, to: string) => number
}

const LENGTH: UnitCategory = {
  units: {
    mm: 0.001, cm: 0.01, m: 1, km: 1000,
    in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344,
  },
}

const WEIGHT: UnitCategory = {
  units: {
    mg: 0.001, g: 1, kg: 1000, t: 1_000_000,
    oz: 28.3495, lb: 453.592,
  },
}

const VOLUME: UnitCategory = {
  units: {
    ml: 0.001, l: 1, gal: 3.78541, qt: 0.946353,
    pt: 0.473176, cup: 0.236588, floz: 0.0295735,
  },
}

const AREA: UnitCategory = {
  units: {
    mm2: 0.000001, cm2: 0.0001, m2: 1, km2: 1_000_000,
    ha: 10_000, acre: 4046.86, ft2: 0.092903, in2: 0.00064516,
  },
}

const SPEED: UnitCategory = {
  units: {
    'km/h': 1, 'mph': 1.60934, 'm/s': 3.6, knot: 1.852,
  },
}

const DATA: UnitCategory = {
  units: {
    b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4,
  },
}

const TEMPERATURE: TemperatureConversion = {
  convert(value: number, from: string, to: string): number {
    // Normalize to Celsius first
    let celsius: number
    switch (from) {
      case 'c': celsius = value; break
      case 'f': celsius = (value - 32) * 5 / 9; break
      case 'k': celsius = value - 273.15; break
      default: throw new Error(`Unknown temperature unit: ${from}`)
    }
    // Convert from Celsius to target
    switch (to) {
      case 'c': return celsius
      case 'f': return celsius * 9 / 5 + 32
      case 'k': return celsius + 273.15
      default: throw new Error(`Unknown temperature unit: ${to}`)
    }
  },
}

const TEMPERATURE_UNITS: ReadonlySet<string> = new Set(['c', 'f', 'k'])

const CATEGORIES: readonly UnitCategory[] = [LENGTH, WEIGHT, VOLUME, AREA, SPEED, DATA]

function convertUnit(value: number, from: string, to: string): number {
  const fromLower = from.toLowerCase()
  const toLower = to.toLowerCase()

  if (fromLower === toLower) return value

  // Temperature special case
  if (TEMPERATURE_UNITS.has(fromLower) && TEMPERATURE_UNITS.has(toLower)) {
    return TEMPERATURE.convert(value, fromLower, toLower)
  }

  // Factor-based categories
  for (const category of CATEGORIES) {
    const fromFactor = category.units[fromLower]
    const toFactor = category.units[toLower]
    if (fromFactor !== undefined && toFactor !== undefined) {
      return (value * fromFactor) / toFactor
    }
  }

  throw new Error(`Cannot convert between "${from}" and "${to}" — units not in the same category`)
}

// ---------------------------------------------------------------------------
// Currency Conversion
// ---------------------------------------------------------------------------

interface ExchangeRateResponse {
  readonly success?: boolean
  readonly result?: number
  readonly error?: { readonly info?: string }
}

async function convertCurrency(amount: number, from: string, to: string): Promise<number> {
  const fromUpper = from.toUpperCase()
  const toUpper = to.toUpperCase()

  if (!/^[A-Z]{3}$/.test(fromUpper) || !/^[A-Z]{3}$/.test(toUpper)) {
    throw new Error('Currency codes must be 3-letter ISO codes (e.g. USD, EUR)')
  }

  const params = new URLSearchParams({
    from: fromUpper,
    to: toUpper,
    amount: String(amount),
  })

  const url = `https://api.exchangerate.host/convert?${params.toString()}`

  const response = await fetch(url, {
    signal: AbortSignal.timeout(CURRENCY_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Exchange rate API error: ${String(response.status)} ${response.statusText}`)
  }

  const data = (await response.json()) as ExchangeRateResponse

  if (data.result === undefined || data.result === null) {
    throw new Error(data.error?.info ?? 'Currency conversion failed — no result from API')
  }

  return data.result
}

// ---------------------------------------------------------------------------
// URL validation (SSRF protection)
// ---------------------------------------------------------------------------

function isPrivateHostname(hostname: string): boolean {
  if (hostname === '::1' || hostname === '[::1]') return true

  const parts = hostname.split('.')
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const octets = parts.map(Number)
    const [a, b] = octets as [number, number, number, number]
    if (a === 127) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 0) return true
  }

  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return true
  }

  const lower = hostname.toLowerCase()
  if (lower.startsWith('fd') || lower.startsWith('fe80')) return true

  return false
}

function validateApiUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: ${raw}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" — only https: is allowed`)
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Host "${parsed.hostname}" is not in the allowed hosts list`)
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`Blocked private/internal hostname: ${parsed.hostname}`)
  }

  return parsed
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): CalculatorArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'calculate') {
    const expression = obj['expression']
    if (typeof expression !== 'string' || expression.trim() === '') {
      throw new Error('calculate requires a non-empty "expression" string')
    }
    return { action: 'calculate', expression: expression.trim() }
  }

  if (action === 'convert') {
    const value = obj['value']
    const from = obj['from']
    const to = obj['to']
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error('convert requires a numeric "value"')
    }
    if (typeof from !== 'string' || from.trim() === '') {
      throw new Error('convert requires a non-empty "from" string')
    }
    if (typeof to !== 'string' || to.trim() === '') {
      throw new Error('convert requires a non-empty "to" string')
    }
    return { action: 'convert', value, from: from.trim(), to: to.trim() }
  }

  if (action === 'currency') {
    const amount = obj['amount']
    const from = obj['from']
    const to = obj['to']
    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new Error('currency requires a numeric "amount"')
    }
    if (typeof from !== 'string' || from.trim() === '') {
      throw new Error('currency requires a non-empty "from" string')
    }
    if (typeof to !== 'string' || to.trim() === '') {
      throw new Error('currency requires a non-empty "to" string')
    }
    return { action: 'currency', amount, from: from.trim(), to: to.trim() }
  }

  throw new Error('action must be "calculate", "convert", or "currency"')
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
      description: 'Action: "calculate", "convert", or "currency"',
      enum: ['calculate', 'convert', 'currency'],
    },
    expression: {
      type: 'string',
      description: 'Math expression to evaluate (calculate). Supports +,-,*,/,^,%, functions (sqrt,sin,cos,tan,log,ln,abs,ceil,floor,round), constants (pi,e).',
    },
    value: {
      type: 'number',
      description: 'Numeric value to convert (convert)',
    },
    amount: {
      type: 'number',
      description: 'Amount to convert (currency)',
    },
    from: {
      type: 'string',
      description: 'Source unit (convert) or currency code (currency, e.g. USD)',
    },
    to: {
      type: 'string',
      description: 'Target unit (convert) or currency code (currency, e.g. EUR)',
    },
  },
  required: ['action'],
}

export const calculatorTool: ExtendedAgentTool = {
  name: 'calculator',
  description:
    'Evaluate math expressions, convert units, and convert currencies. Actions: calculate(expression) evaluates arithmetic; convert(value, from, to) converts units; currency(amount, from, to) converts currencies via exchange rate API.',
  parameters,
  permissions: ['net:http'],
  requiresConfirmation: false,
  defaultRiskTier: 0,
  riskTiers: { calculate: 0, convert: 0, currency: 2 },
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'calculate': {
        const result = evaluate(parsed.expression)
        return textResult(JSON.stringify({ expression: parsed.expression, result }))
      }
      case 'convert': {
        const result = convertUnit(parsed.value, parsed.from, parsed.to)
        return textResult(JSON.stringify({
          value: parsed.value,
          from: parsed.from,
          to: parsed.to,
          result,
        }))
      }
      case 'currency': {
        const result = await convertCurrency(parsed.amount, parsed.from, parsed.to)
        return textResult(JSON.stringify({
          amount: parsed.amount,
          from: parsed.from.toUpperCase(),
          to: parsed.to.toUpperCase(),
          result,
        }))
      }
    }
  },
}

export { evaluate, convertUnit, validateApiUrl }
