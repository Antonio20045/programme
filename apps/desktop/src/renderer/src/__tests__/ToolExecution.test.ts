import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock React hooks
// ---------------------------------------------------------------------------

interface StateSlot<T> {
  value: T
  setter: (v: T | ((prev: T) => T)) => void
}

let stateSlots: StateSlot<unknown>[] = []
let stateIndex = 0

vi.mock('react', () => ({
  useState: <T,>(initial: T) => {
    if (stateIndex < stateSlots.length) {
      const slot = stateSlots.at(stateIndex)
      stateIndex++
      if (slot) return [slot.value, slot.setter]
    }
    const slot: StateSlot<T> = {
      value: initial,
      setter: (v: T | ((prev: T) => T)) => {
        slot.value = typeof v === 'function' ? (v as (prev: T) => T)(slot.value) : v
      },
    }
    stateSlots.push(slot as StateSlot<unknown>)
    stateIndex++
    return [slot.value, slot.setter]
  },
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

import ToolExecution, {
  truncateResult,
  formatParams,
  summarizeParams,
  TOOL_ICONS,
} from '../components/ToolExecution'
import { formatDuration } from '../utils/format-date'
import type { ToolExecutionProps } from '../components/ToolExecution'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(): void {
  stateSlots = []
  stateIndex = 0
}

function createProps(overrides?: Partial<ToolExecutionProps>): ToolExecutionProps {
  return {
    toolName: 'web-search',
    params: { query: 'test' },
    startedAt: 1000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  it('formats milliseconds for short durations', () => {
    expect(formatDuration(0, 500)).toBe('500ms')
  })

  it('formats seconds for durations >= 1s', () => {
    expect(formatDuration(0, 1500)).toBe('1.5s')
  })

  it('formats exact seconds', () => {
    expect(formatDuration(0, 3000)).toBe('3.0s')
  })

  it('handles zero duration', () => {
    expect(formatDuration(1000, 1000)).toBe('0ms')
  })
})

describe('truncateResult', () => {
  it('returns short strings unchanged', () => {
    expect(truncateResult('hello', 500)).toBe('hello')
  })

  it('truncates strings beyond maxLength', () => {
    const long = 'a'.repeat(600)
    const result = truncateResult(long, 500)
    expect(result).toHaveLength(501) // 500 chars + ellipsis
    expect(result.endsWith('…')).toBe(true)
  })

  it('serializes objects to JSON', () => {
    const obj = { key: 'value' }
    const result = truncateResult(obj, 500)
    expect(result).toContain('"key"')
    expect(result).toContain('"value"')
  })

  it('truncates long JSON results', () => {
    const obj = { data: 'x'.repeat(600) }
    const result = truncateResult(obj, 500)
    expect(result.length).toBeLessThanOrEqual(501)
    expect(result.endsWith('…')).toBe(true)
  })
})

describe('formatParams', () => {
  it('formats params as indented JSON', () => {
    const result = formatParams({ query: 'test', limit: 10 })
    expect(result).toContain('"query": "test"')
    expect(result).toContain('"limit": 10')
    // Indented with 2 spaces
    expect(result).toContain('  ')
  })

  it('handles empty params', () => {
    expect(formatParams({})).toBe('{}')
  })
})

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------

describe('ToolExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('is a function component', () => {
    expect(typeof ToolExecution).toBe('function')
  })

  it('renders without crashing', () => {
    stateIndex = 0
    const result = ToolExecution(createProps())
    expect(result).toBeDefined()
  })

  it('shows tool name', () => {
    stateIndex = 0
    const result = ToolExecution(createProps({ toolName: 'filesystem' }))
    const json = JSON.stringify(result)
    expect(json).toContain('filesystem')
  })

  it('shows spinner when tool is running (no finishedAt)', () => {
    stateIndex = 0
    const result = ToolExecution(createProps({ finishedAt: undefined }))
    const json = JSON.stringify(result)
    expect(json).toContain('animate-spin')
    expect(json).toContain('läuft')
  })

  it('shows duration when tool is finished', () => {
    stateIndex = 0
    const result = ToolExecution(createProps({ startedAt: 0, finishedAt: 2500 }))
    const json = JSON.stringify(result)
    expect(json).toContain('abgeschlossen')
    expect(json).toContain('2.5s')
  })

  it('starts collapsed (max-h-0)', () => {
    stateIndex = 0
    const result = ToolExecution(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('max-h-0')
  })

  it('expands when state is true (max-h-96)', () => {
    // Pre-set expanded state to true
    stateSlots = [
      {
        value: true,
        setter: () => {},
      },
    ]
    stateIndex = 0
    const result = ToolExecution(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('max-h-96')
  })

  it('shows params in expanded view', () => {
    stateSlots = [
      {
        value: true,
        setter: () => {},
      },
    ]
    stateIndex = 0
    const result = ToolExecution(createProps({ params: { query: 'wetter morgen' } }))
    const json = JSON.stringify(result)
    expect(json).toContain('Parameter')
    expect(json).toContain('wetter morgen')
  })

  it('shows result when provided and expanded', () => {
    stateSlots = [
      {
        value: true,
        setter: () => {},
      },
    ]
    stateIndex = 0
    const result = ToolExecution(
      createProps({ result: 'Morgen wird es sonnig.', finishedAt: 2000 }),
    )
    const json = JSON.stringify(result)
    expect(json).toContain('Ergebnis')
    expect(json).toContain('Morgen wird es sonnig.')
  })

  it('does not show result section when result is undefined', () => {
    stateSlots = [
      {
        value: true,
        setter: () => {},
      },
    ]
    stateIndex = 0
    const result = ToolExecution(createProps({ result: undefined }))
    const json = JSON.stringify(result)
    expect(json).not.toContain('Ergebnis')
  })

  it('rotates arrow icon when expanded', () => {
    stateSlots = [
      {
        value: true,
        setter: () => {},
      },
    ]
    stateIndex = 0
    const result = ToolExecution(createProps())
    const json = JSON.stringify(result)
    expect(json).toContain('rotate-90')
  })

  it('does not rotate arrow when collapsed', () => {
    stateIndex = 0
    const result = ToolExecution(createProps())
    const json = JSON.stringify(result)
    // The arrow should not have rotate-90 class
    // It should just have the base classes without rotation
    expect(json).not.toContain('rotate-90')
  })

  it('shows tool icon for known tools', () => {
    stateIndex = 0
    const result = ToolExecution(createProps({ toolName: 'filesystem' }))
    const json = JSON.stringify(result)
    expect(json).toContain('\u{1F4C1}')
  })

  it('shows compact param summary', () => {
    stateIndex = 0
    const result = ToolExecution(createProps({ params: { query: 'wetter' } }))
    const json = JSON.stringify(result)
    expect(json).toContain('query: wetter')
  })
})

describe('summarizeParams', () => {
  it('returns empty string for empty params', () => {
    expect(summarizeParams({})).toBe('')
  })

  it('formats single param', () => {
    expect(summarizeParams({ query: 'test' })).toBe('query: test')
  })

  it('formats two params', () => {
    const result = summarizeParams({ query: 'test', limit: 10 })
    expect(result).toContain('query: test')
    expect(result).toContain('limit: 10')
  })

  it('truncates long values', () => {
    const result = summarizeParams({ data: 'x'.repeat(60) })
    expect(result.length).toBeLessThan(60)
    expect(result).toContain('\u2026')
  })

  it('adds ellipsis for more than 2 params', () => {
    const result = summarizeParams({ a: 1, b: 2, c: 3 })
    expect(result).toContain('\u2026')
  })
})

describe('TOOL_ICONS', () => {
  it('has icons for common tools', () => {
    expect(TOOL_ICONS.get('web-search')).toBeDefined()
    expect(TOOL_ICONS.get('filesystem')).toBeDefined()
    expect(TOOL_ICONS.get('gmail')).toBeDefined()
    expect(TOOL_ICONS.get('calendar')).toBeDefined()
  })
})
