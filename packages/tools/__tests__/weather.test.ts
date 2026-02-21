import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { weatherTool, sanitizeLocation } from '../src/weather'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/weather.ts')
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
    }),
  )
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_WEATHER_RESPONSE = {
  current_condition: [
    {
      temp_C: '15',
      FeelsLikeC: '13',
      humidity: '72',
      weatherDesc: [{ value: 'Partly cloudy' }],
      windspeedKmph: '12',
      winddir16Point: 'NW',
      uvIndex: '3',
    },
  ],
  weather: [
    {
      date: '2026-02-18',
      maxtempC: '18',
      mintempC: '8',
      astronomy: [{ sunrise: '07:15 AM', sunset: '05:45 PM' }],
      hourly: [
        {
          time: '900',
          tempC: '12',
          weatherDesc: [{ value: 'Sunny' }],
          chanceofrain: '10',
        },
        {
          time: '1500',
          tempC: '17',
          weatherDesc: [{ value: 'Partly cloudy' }],
          chanceofrain: '20',
        },
      ],
    },
    {
      date: '2026-02-19',
      maxtempC: '16',
      mintempC: '7',
      astronomy: [{ sunrise: '07:14 AM', sunset: '05:46 PM' }],
      hourly: [
        {
          time: '900',
          tempC: '10',
          weatherDesc: [{ value: 'Overcast' }],
          chanceofrain: '40',
        },
      ],
    },
    {
      date: '2026-02-20',
      maxtempC: '14',
      mintempC: '5',
      astronomy: [{ sunrise: '07:13 AM', sunset: '05:47 PM' }],
      hourly: [],
    },
  ],
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('weather tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(weatherTool.name).toBe('weather')
    })

    it('runs on server', () => {
      expect(weatherTool.runsOn).toBe('server')
    })

    it('has net:http permission', () => {
      expect(weatherTool.permissions).toContain('net:http')
    })

    it('does not require confirmation (read-only)', () => {
      expect(weatherTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // current()
  // -------------------------------------------------------------------------

  describe('current()', () => {
    it('returns structured current weather data', async () => {
      mockFetchJson(MOCK_WEATHER_RESPONSE)

      const result = await weatherTool.execute({
        action: 'current',
        location: 'Berlin',
      })

      expect(result.content).toHaveLength(1)
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as Record<string, unknown>

      expect(parsed).toEqual({
        location: 'Berlin',
        temperature_C: '15',
        feelsLike_C: '13',
        humidity: '72',
        description: 'Partly cloudy',
        wind: { speed_kmh: '12', direction: 'NW' },
        uvIndex: '3',
      })
    })

    it('throws when no weather data available', async () => {
      mockFetchJson({ current_condition: [] })

      await expect(
        weatherTool.execute({ action: 'current', location: 'Nowhere' }),
      ).rejects.toThrow('No weather data available')
    })

    it('throws on API error', async () => {
      mockFetchJson({}, 500)

      await expect(
        weatherTool.execute({ action: 'current', location: 'Berlin' }),
      ).rejects.toThrow('Weather API error')
    })
  })

  // -------------------------------------------------------------------------
  // forecast()
  // -------------------------------------------------------------------------

  describe('forecast()', () => {
    it('returns 3-day forecast with hourly details', async () => {
      mockFetchJson(MOCK_WEATHER_RESPONSE)

      const result = await weatherTool.execute({
        action: 'forecast',
        location: 'Berlin',
      })

      expect(result.content).toHaveLength(1)
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { location: string; forecast: unknown[] }

      expect(parsed.location).toBe('Berlin')
      expect(parsed.forecast).toHaveLength(3)
    })

    it('includes sunrise and sunset', async () => {
      mockFetchJson(MOCK_WEATHER_RESPONSE)

      const result = await weatherTool.execute({
        action: 'forecast',
        location: 'Berlin',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { forecast: { sunrise: string; sunset: string }[] }

      expect(parsed.forecast[0]?.sunrise).toBe('07:15 AM')
      expect(parsed.forecast[0]?.sunset).toBe('05:45 PM')
    })

    it('throws when no forecast data available', async () => {
      mockFetchJson({ weather: [] })

      await expect(
        weatherTool.execute({ action: 'forecast', location: 'Nowhere' }),
      ).rejects.toThrow('No forecast data available')
    })
  })

  // -------------------------------------------------------------------------
  // sanitizeLocation()
  // -------------------------------------------------------------------------

  describe('sanitizeLocation()', () => {
    it('accepts simple city names', () => {
      expect(sanitizeLocation('Berlin')).toBe('Berlin')
    })

    it('accepts city with state', () => {
      expect(sanitizeLocation('New York, NY')).toBe('New York, NY')
    })

    it('accepts accented characters', () => {
      expect(sanitizeLocation('München')).toBe('München')
      expect(sanitizeLocation('Zürich')).toBe('Zürich')
      expect(sanitizeLocation('São Paulo')).toBe('São Paulo')
    })

    it('trims whitespace', () => {
      expect(sanitizeLocation('  Berlin  ')).toBe('Berlin')
    })

    it('rejects empty string', () => {
      expect(() => sanitizeLocation('')).toThrow('must not be empty')
    })

    it('rejects whitespace-only string', () => {
      expect(() => sanitizeLocation('   ')).toThrow('must not be empty')
    })

    it('rejects too-long location', () => {
      expect(() => sanitizeLocation('A'.repeat(101))).toThrow('too long')
    })

    it('rejects path traversal', () => {
      expect(() => sanitizeLocation('/etc/passwd')).toThrow('invalid characters')
    })

    it('rejects query string injection', () => {
      expect(() => sanitizeLocation('Berlin?q=inject')).toThrow('invalid characters')
    })

    it('rejects hash injection', () => {
      expect(() => sanitizeLocation('Berlin#anchor')).toThrow('invalid characters')
    })

    it('rejects @ sign', () => {
      expect(() => sanitizeLocation('user@host')).toThrow('invalid characters')
    })

    it('rejects colon', () => {
      expect(() => sanitizeLocation('http://evil')).toThrow('invalid characters')
    })

    it('rejects null bytes', () => {
      expect(() => sanitizeLocation('Berlin\0')).toThrow('null bytes')
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(weatherTool.execute(null)).rejects.toThrow(
        'Arguments must be an object',
      )
    })

    it('rejects non-object args', async () => {
      await expect(weatherTool.execute('string')).rejects.toThrow(
        'Arguments must be an object',
      )
    })

    it('rejects unknown action', async () => {
      await expect(
        weatherTool.execute({ action: 'delete', location: 'Berlin' }),
      ).rejects.toThrow('action must be "current" or "forecast"')
    })

    it('rejects missing location', async () => {
      await expect(
        weatherTool.execute({ action: 'current' }),
      ).rejects.toThrow('non-empty "location"')
    })

    it('rejects empty location', async () => {
      await expect(
        weatherTool.execute({ action: 'current', location: '' }),
      ).rejects.toThrow('non-empty "location"')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no eval/exec patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, ['https://wttr.in'])
    })
  })
})
