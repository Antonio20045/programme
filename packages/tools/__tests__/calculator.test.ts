import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { calculatorTool, evaluate, convertUnit, validateApiUrl } from '../src/calculator'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/calculator.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    }),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calculator tool', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(calculatorTool.name).toBe('calculator')
    })

    it('runs on server', () => {
      expect(calculatorTool.runsOn).toBe('server')
    })

    it('has net:http permission', () => {
      expect(calculatorTool.permissions).toContain('net:http')
    })

    it('does not require confirmation', () => {
      expect(calculatorTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // calculate() — arithmetic
  // -------------------------------------------------------------------------

  describe('calculate()', () => {
    it('evaluates simple addition', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: '2 + 3' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(5)
    })

    it('evaluates subtraction', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: '10 - 4' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(6)
    })

    it('evaluates multiplication', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: '6 * 7' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(42)
    })

    it('evaluates division', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: '15 / 3' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(5)
    })

    it('evaluates modulo', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: '17 % 5' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(2)
    })

    it('respects operator precedence', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: '2 + 3 * 4' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(14)
    })

    it('handles parentheses', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: '(2 + 3) * 4' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(20)
    })

    it('handles nested parentheses', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: '((2 + 3) * (4 - 1))' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(15)
    })

    it('evaluates exponentiation (right-associative)', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: '2 ^ 3 ^ 2' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      // 2^(3^2) = 2^9 = 512 (right-associative)
      expect(parsed.result).toBe(512)
    })

    it('handles unary minus', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: '-5 + 3' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(-2)
    })

    it('evaluates sqrt function', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: 'sqrt(16)' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(4)
    })

    it('evaluates abs function', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: 'abs(-42)' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(42)
    })

    it('evaluates ceil function', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: 'ceil(4.2)' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(5)
    })

    it('evaluates floor function', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: 'floor(4.8)' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(4)
    })

    it('evaluates round function', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: 'round(4.5)' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(5)
    })

    it('evaluates sin function', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: 'sin(0)' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(0)
    })

    it('evaluates cos function', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: 'cos(0)' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(1)
    })

    it('evaluates log (base 10) function', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: 'log(100)' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(2)
    })

    it('evaluates ln (natural log) function', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: 'ln(e)' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(1)
    })

    it('handles pi constant', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: '2 * pi' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(2 * Math.PI)
    })

    it('handles e constant', async () => {
      const result = await calculatorTool.execute({ action: 'calculate', expression: 'e ^ 2' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(Math.E ** 2)
    })

    it('throws on division by zero', async () => {
      await expect(
        calculatorTool.execute({ action: 'calculate', expression: '5 / 0' }),
      ).rejects.toThrow('Division by zero')
    })

    it('throws on modulo by zero', async () => {
      await expect(
        calculatorTool.execute({ action: 'calculate', expression: '5 % 0' }),
      ).rejects.toThrow('Division by zero')
    })

    it('throws on empty expression', async () => {
      await expect(
        calculatorTool.execute({ action: 'calculate', expression: '' }),
      ).rejects.toThrow('non-empty "expression"')
    })

    it('throws on expression exceeding max length', async () => {
      const longExpr = '1+'.repeat(501) + '1'
      await expect(
        calculatorTool.execute({ action: 'calculate', expression: longExpr }),
      ).rejects.toThrow('too long')
    })

    it('throws on unknown identifier', async () => {
      await expect(
        calculatorTool.execute({ action: 'calculate', expression: 'foo + 1' }),
      ).rejects.toThrow('Unknown identifier')
    })

    it('throws on unexpected character', async () => {
      await expect(
        calculatorTool.execute({ action: 'calculate', expression: '2 & 3' }),
      ).rejects.toThrow('Unexpected character')
    })
  })

  // -------------------------------------------------------------------------
  // evaluate() — exported function
  // -------------------------------------------------------------------------

  describe('evaluate()', () => {
    it('handles decimal numbers', () => {
      expect(evaluate('3.14 * 2')).toBeCloseTo(6.28)
    })

    it('complex expression', () => {
      expect(evaluate('sqrt(9) + 2 ^ 3 * (1 + 1)')).toBe(19)
    })
  })

  // -------------------------------------------------------------------------
  // convert() — unit conversion
  // -------------------------------------------------------------------------

  describe('convert()', () => {
    it('converts km to miles', async () => {
      const result = await calculatorTool.execute({ action: 'convert', value: 10, from: 'km', to: 'mi' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(6.21371, 3)
    })

    it('converts meters to feet', async () => {
      const result = await calculatorTool.execute({ action: 'convert', value: 1, from: 'm', to: 'ft' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(3.28084, 3)
    })

    it('converts kg to lb', async () => {
      const result = await calculatorTool.execute({ action: 'convert', value: 1, from: 'kg', to: 'lb' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(2.20462, 3)
    })

    it('converts liters to gallons', async () => {
      const result = await calculatorTool.execute({ action: 'convert', value: 1, from: 'l', to: 'gal' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(0.264172, 3)
    })

    it('converts Celsius to Fahrenheit', async () => {
      const result = await calculatorTool.execute({ action: 'convert', value: 100, from: 'c', to: 'f' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(212)
    })

    it('converts Fahrenheit to Celsius', async () => {
      const result = await calculatorTool.execute({ action: 'convert', value: 32, from: 'f', to: 'c' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(0)
    })

    it('converts Celsius to Kelvin', async () => {
      const result = await calculatorTool.execute({ action: 'convert', value: 0, from: 'c', to: 'k' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(273.15)
    })

    it('converts km/h to mph', async () => {
      const result = await calculatorTool.execute({ action: 'convert', value: 100, from: 'km/h', to: 'mph' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(62.1371, 2)
    })

    it('converts GB to MB', async () => {
      const result = await calculatorTool.execute({ action: 'convert', value: 1, from: 'gb', to: 'mb' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(1024)
    })

    it('converts m2 to ft2', async () => {
      const result = await calculatorTool.execute({ action: 'convert', value: 1, from: 'm2', to: 'ft2' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBeCloseTo(10.7639, 2)
    })

    it('returns same value for same unit', async () => {
      const result = await calculatorTool.execute({ action: 'convert', value: 42, from: 'km', to: 'km' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(42)
    })

    it('throws for incompatible units', async () => {
      await expect(
        calculatorTool.execute({ action: 'convert', value: 1, from: 'km', to: 'kg' }),
      ).rejects.toThrow('not in the same category')
    })
  })

  // -------------------------------------------------------------------------
  // convertUnit() — exported
  // -------------------------------------------------------------------------

  describe('convertUnit()', () => {
    it('converts inches to centimeters', () => {
      expect(convertUnit(1, 'in', 'cm')).toBeCloseTo(2.54)
    })
  })

  // -------------------------------------------------------------------------
  // currency() — mock fetch
  // -------------------------------------------------------------------------

  describe('currency()', () => {
    it('converts USD to EUR', async () => {
      mockFetchJson({ success: true, result: 85.5 })

      const result = await calculatorTool.execute({ action: 'currency', amount: 100, from: 'usd', to: 'eur' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as { result: number }
      expect(parsed.result).toBe(85.5)
      expect(parsed).toHaveProperty('from', 'USD')
      expect(parsed).toHaveProperty('to', 'EUR')
    })

    it('throws on invalid currency code', async () => {
      await expect(
        calculatorTool.execute({ action: 'currency', amount: 100, from: 'ABCD', to: 'EUR' }),
      ).rejects.toThrow('3-letter ISO')
    })

    it('throws on API error', async () => {
      mockFetchJson({}, 500)

      await expect(
        calculatorTool.execute({ action: 'currency', amount: 100, from: 'usd', to: 'eur' }),
      ).rejects.toThrow('Exchange rate API error')
    })

    it('throws when API returns no result', async () => {
      mockFetchJson({ success: false })

      await expect(
        calculatorTool.execute({ action: 'currency', amount: 100, from: 'usd', to: 'eur' }),
      ).rejects.toThrow('conversion failed')
    })
  })

  // -------------------------------------------------------------------------
  // validateApiUrl() — exported
  // -------------------------------------------------------------------------

  describe('validateApiUrl()', () => {
    it('accepts allowed host', () => {
      const parsed = validateApiUrl('https://api.exchangerate.host/convert')
      expect(parsed.hostname).toBe('api.exchangerate.host')
    })

    it('rejects non-allowed host', () => {
      expect(() => validateApiUrl('https://evil.com/api')).toThrow('not in the allowed hosts')
    })

    it('rejects http scheme', () => {
      expect(() => validateApiUrl('http://api.exchangerate.host/convert')).toThrow('only https:')
    })
  })

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(calculatorTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(calculatorTool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        calculatorTool.execute({ action: 'hack' }),
      ).rejects.toThrow('action must be')
    })

    it('rejects calculate without expression', async () => {
      await expect(
        calculatorTool.execute({ action: 'calculate' }),
      ).rejects.toThrow('non-empty "expression"')
    })

    it('rejects convert without value', async () => {
      await expect(
        calculatorTool.execute({ action: 'convert', from: 'km', to: 'mi' }),
      ).rejects.toThrow('numeric "value"')
    })

    it('rejects convert with NaN value', async () => {
      await expect(
        calculatorTool.execute({ action: 'convert', value: NaN, from: 'km', to: 'mi' }),
      ).rejects.toThrow('numeric "value"')
    })

    it('rejects currency without amount', async () => {
      await expect(
        calculatorTool.execute({ action: 'currency', from: 'usd', to: 'eur' }),
      ).rejects.toThrow('numeric "amount"')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [
        'https://api.exchangerate.host',
      ])
    })
  })
})
