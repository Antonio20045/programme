/**
 * Weather tool — current conditions and 3-day forecast.
 * Backend: wttr.in (no API key required).
 *
 * Security: Location string is sanitized to alphanumeric + common chars.
 * Domain is hardcoded — no user-controlled URL construction.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CurrentArgs {
  readonly action: 'current'
  readonly location: string
}

interface ForecastArgs {
  readonly action: 'forecast'
  readonly location: string
}

type WeatherArgs = CurrentArgs | ForecastArgs

interface WttrCurrentCondition {
  readonly temp_C?: string
  readonly FeelsLikeC?: string
  readonly humidity?: string
  readonly weatherDesc?: readonly { readonly value?: string }[]
  readonly windspeedKmph?: string
  readonly winddir16Point?: string
  readonly uvIndex?: string
}

interface WttrHourly {
  readonly time?: string
  readonly tempC?: string
  readonly weatherDesc?: readonly { readonly value?: string }[]
  readonly chanceofrain?: string
}

interface WttrAstronomy {
  readonly sunrise?: string
  readonly sunset?: string
}

interface WttrDay {
  readonly date?: string
  readonly maxtempC?: string
  readonly mintempC?: string
  readonly astronomy?: readonly WttrAstronomy[]
  readonly hourly?: readonly WttrHourly[]
}

interface WttrResponse {
  readonly current_condition?: readonly WttrCurrentCondition[]
  readonly weather?: readonly WttrDay[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000
const MAX_LOCATION_LENGTH = 100

/**
 * Allowed characters: letters (including accented), digits, spaces, commas,
 * periods, hyphens. Blocks URL-special chars (/, ?, #, @, :) to prevent
 * URL injection against wttr.in.
 */
const LOCATION_PATTERN = /^[a-zA-Z0-9\s,.\-\u00C0-\u024F]+$/

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

function sanitizeLocation(location: string): string {
  const trimmed = location.trim()

  if (trimmed === '') {
    throw new Error('Location must not be empty')
  }

  if (trimmed.length > MAX_LOCATION_LENGTH) {
    throw new Error(`Location too long (max ${String(MAX_LOCATION_LENGTH)} characters)`)
  }

  if (trimmed.includes('\0')) {
    throw new Error('Location contains null bytes')
  }

  if (!LOCATION_PATTERN.test(trimmed)) {
    throw new Error('Location contains invalid characters')
  }

  return trimmed
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): WeatherArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'current' || action === 'forecast') {
    const location = obj['location']
    if (typeof location !== 'string' || location.trim() === '') {
      throw new Error(`${action} requires a non-empty "location" string`)
    }
    return { action, location: location.trim() }
  }

  throw new Error('action must be "current" or "forecast"')
}

// ---------------------------------------------------------------------------
// API fetch
// ---------------------------------------------------------------------------

async function fetchWeather(location: string): Promise<WttrResponse> {
  const safe = sanitizeLocation(location)
  const url = `https://wttr.in/${encodeURIComponent(safe)}?format=j1`

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Weather API error: ${String(response.status)} ${response.statusText}`)
  }

  return (await response.json()) as WttrResponse
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

async function executeCurrent(location: string): Promise<AgentToolResult> {
  const data = await fetchWeather(location)
  const condition = data.current_condition?.[0]

  if (!condition) {
    throw new Error('No weather data available for this location')
  }

  const result = {
    location,
    temperature_C: condition.temp_C ?? 'N/A',
    feelsLike_C: condition.FeelsLikeC ?? 'N/A',
    humidity: condition.humidity ?? 'N/A',
    description: condition.weatherDesc?.[0]?.value ?? 'N/A',
    wind: {
      speed_kmh: condition.windspeedKmph ?? 'N/A',
      direction: condition.winddir16Point ?? 'N/A',
    },
    uvIndex: condition.uvIndex ?? 'N/A',
  }

  return textResult(JSON.stringify(result))
}

async function executeForecast(location: string): Promise<AgentToolResult> {
  const data = await fetchWeather(location)
  const days = data.weather ?? []

  if (days.length === 0) {
    throw new Error('No forecast data available for this location')
  }

  const forecast = days.slice(0, 3).map((day) => ({
    date: day.date ?? 'N/A',
    maxTemp_C: day.maxtempC ?? 'N/A',
    minTemp_C: day.mintempC ?? 'N/A',
    sunrise: day.astronomy?.[0]?.sunrise ?? 'N/A',
    sunset: day.astronomy?.[0]?.sunset ?? 'N/A',
    hourly: (day.hourly ?? []).map((h) => ({
      time: h.time ?? 'N/A',
      temp_C: h.tempC ?? 'N/A',
      description: h.weatherDesc?.[0]?.value ?? 'N/A',
      chanceOfRain: h.chanceofrain ?? 'N/A',
    })),
  }))

  return textResult(JSON.stringify({ location, forecast }))
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action to perform: "current" for current conditions, "forecast" for 3-day forecast',
      enum: ['current', 'forecast'],
    },
    location: {
      type: 'string',
      description: 'Location name (e.g. "Berlin", "New York, NY", "Tokyo")',
    },
  },
  required: ['action', 'location'],
}

export const weatherTool: ExtendedAgentTool = {
  name: 'weather',
  description:
    'Get weather information. Actions: current(location) returns temperature, humidity, wind, UV index; forecast(location) returns 3-day forecast with hourly details.',
  parameters,
  permissions: ['net:http'],
  requiresConfirmation: false,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'current':
        return executeCurrent(parsed.location)
      case 'forecast':
        return executeForecast(parsed.location)
    }
  },
}

export { sanitizeLocation }
