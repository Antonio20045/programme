import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock React hooks (same pattern as Setup.test.ts)
// ---------------------------------------------------------------------------

interface StateSlot<T> {
  value: T
  setter: (v: T | ((prev: T) => T)) => void
}

let stateSlots: StateSlot<unknown>[] = []
let stateIndex = 0
let effectFns: Array<() => void | (() => void)> = []

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
  useEffect: (fn: () => void | (() => void)) => {
    effectFns.push(fn)
  },
  useRef: <T,>(initial: T) => ({ current: initial }),
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

import Settings from '../pages/Settings'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(): void {
  stateSlots = []
  stateIndex = 0
  effectFns = []
}

function makeSlot<T>(value: T): StateSlot<T> {
  return { value, setter: vi.fn() } as StateSlot<T>
}

/**
 * Build state slots for a loaded Settings component.
 * Slot order matches useState calls in Settings():
 *  0: activeTab
 *  1: toast
 *  2: capabilities
 *  3: disabledIds
 *  4: capLoading
 *  5: toggling
 *  6: memoryData
 *  7: memoryLoading
 *  8: memorySearch
 *  9: memoryDeleteConfirm
 *  10: ltmCollapsed
 *  11: dailyCollapsed
 */
function makeLoadedSlots(overrides: Partial<Record<number, unknown>> = {}): void {
  const defaults: unknown[] = [
    'zugriffe',                         // 0: activeTab
    null,                               // 1: toast
    [                                   // 2: capabilities
      { id: 'notes', section: 'personal', available: true },
      { id: 'reminders', section: 'personal', available: true },
      { id: 'shell', section: 'system', available: true },
      { id: 'browser', section: 'system', available: true },
    ],
    new Set<string>(),                  // 3: disabledIds
    false,                              // 4: capLoading
    null,                               // 5: toggling
    null,                               // 6: memoryData
    false,                              // 7: memoryLoading
    '',                                 // 8: memorySearch
    null,                               // 9: memoryDeleteConfirm
    false,                              // 10: ltmCollapsed
    false,                              // 11: dailyCollapsed
  ]
  for (const [idx, val] of Object.entries(overrides)) {
    defaults[Number(idx)] = val
  }
  stateSlots = defaults.map((v) => makeSlot(v))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('is a function component', () => {
    expect(typeof Settings).toBe('function')
  })

  it('exports a default function named Settings', () => {
    expect(Settings.name).toBe('Settings')
  })

  it('renders loading skeleton when capLoading is true', () => {
    // Default state: capLoading = true (slot 4)
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('Einstellungen')
    expect(json).toContain('animate-pulse')
  })

  it('renders tab bar when loaded', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('Zugriffe')
    expect(json).toContain('Memory')
  })

  it('renders only 2 tabs', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('Zugriffe')
    expect(json).toContain('Memory')
    expect(json).not.toContain('Allgemein')
    expect(json).not.toContain('Integrationen')
    expect(json).not.toContain('"Aktivit')
  })

  it('passes capabilities to ZugriffeTab', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    // Capabilities are passed as props to ZugriffeTab
    expect(json).toContain('"id":"notes"')
    expect(json).toContain('"id":"shell"')
    expect(json).toContain('"section":"personal"')
    expect(json).toContain('"section":"system"')
  })

  it('passes disabledIds as empty when nothing disabled', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    // Set serializes as {} in JSON
    expect(json).toContain('"disabledIds":{}')
  })

  it('passes toggling as null by default', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"toggling":null')
  })

  it('passes toggling value when set', () => {
    makeLoadedSlots({ 5: 'shell' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"toggling":"shell"')
  })

  it('passes memoryData to MemoryTab', () => {
    const memData = {
      longTerm: [{ id: 'Farbe', title: 'Farbe', content: 'Blau' }],
      daily: [],
    }
    makeLoadedSlots({ 0: 'memory', 6: memData })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"title":"Farbe"')
    expect(json).toContain('"content":"Blau"')
  })

  it('passes memoryData as null when not loaded', () => {
    makeLoadedSlots({ 0: 'memory' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"memoryData":null')
  })

  it('passes memoryLoading prop to Memory tab', () => {
    makeLoadedSlots({ 0: 'memory', 7: true })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"memoryLoading":true')
  })

  it('passes memorySearch prop', () => {
    makeLoadedSlots({ 0: 'memory', 8: 'test' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"memorySearch":"test"')
  })

  it('passes memoryDeleteConfirm prop', () => {
    makeLoadedSlots({ 0: 'memory', 9: { type: 'longTerm', id: 'Farbe' } })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"memoryDeleteConfirm"')
    expect(json).toContain('"type":"longTerm"')
  })

  it('passes daily memory data', () => {
    const memData = {
      longTerm: [],
      daily: [{ date: '2026-02-17', entries: [{ id: '2026-02-17:0', content: 'Notiz eins' }] }],
    }
    makeLoadedSlots({ 0: 'memory', 6: memData })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"date":"2026-02-17"')
    expect(json).toContain('"content":"Notiz eins"')
  })

  it('renders toast when toast state is set', () => {
    makeLoadedSlots({ 1: { message: 'Gespeichert', type: 'success' } })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"message":"Gespeichert"')
    expect(json).toContain('"show":true')
  })

  it('toast has show=false when toast state is null', () => {
    makeLoadedSlots({ 1: null })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"show":false')
  })

  it('uses tablist role for tab bar', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"role":"tablist"')
  })

  it('active tab has aria-selected true', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"aria-selected":true')
  })

  it('heading says Einstellungen', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('Einstellungen')
  })

  it('does not render old tab content', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).not.toContain('Verbindungsmodus')
    expect(json).not.toContain('Persona')
    expect(json).not.toContain('"currentModel"')
  })

  it('passes ltmCollapsed and dailyCollapsed to MemoryTab', () => {
    makeLoadedSlots({ 0: 'memory', 10: true, 11: true })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"ltmCollapsed":true')
    expect(json).toContain('"dailyCollapsed":true')
  })

  it('does not show Memory tab content when on Zugriffe tab', () => {
    makeLoadedSlots({ 0: 'zugriffe' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).not.toContain('"memoryData"')
  })

  it('does not show Zugriffe content when on Memory tab', () => {
    makeLoadedSlots({ 0: 'memory' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).not.toContain('"capabilities"')
  })

  it('passes empty capabilities array', () => {
    makeLoadedSlots({ 2: [] })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"capabilities":[]')
  })
})
