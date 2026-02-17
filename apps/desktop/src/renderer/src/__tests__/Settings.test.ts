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

// Default SettingsConfig mock for loaded state
const mockConfig = {
  identity: { name: 'Alex', theme: 'friendly' as const, emoji: '\u{1F916}' },
  model: 'anthropic/claude-sonnet-4-5',
  provider: 'anthropic',
  apiKeyLast4: 'abcd',
  allowedPaths: ['/Users/test'],
}

/**
 * Build state slots for a loaded Settings component.
 * Slot order matches useState calls in Settings():
 *  0: loading, 1: config, 2: activeTab,
 *  3: pendingModel, 4: modelSaving,
 *  5: personaName, 6: personaTone, 7: personaDirty, 8: personaSaving,
 *  9: apiKeyExpanded, 10: newApiKey, 11: apiKeyValidating, 12: apiKeyError,
 *  13: folderAdding,
 *  14: connectionMode, 15: serverUrl, 16: serverToken,
 *  17: connectionSaving, 18: connectionTesting, 19: connectionTestResult, 20: tokenLast4,
 *  21: integrationStatus, 22: connectingService, 23: disconnectConfirm,
 *  24: toast,
 *  25: memoryData, 26: memoryLoading, 27: memorySearch,
 *  28: memoryDeleteConfirm, 29: ltmCollapsed, 30: dailyCollapsed,
 *  31: activityData, 32: activityLoading, 33: activityFilter,
 *  34: activityExpandedId
 */
function makeLoadedSlots(overrides: Partial<Record<number, unknown>> = {}): void {
  const defaults: unknown[] = [
    false,                              // 0: loading
    mockConfig,                         // 1: config
    'allgemein',                        // 2: activeTab
    'anthropic/claude-sonnet-4-5',      // 3: pendingModel
    false,                              // 4: modelSaving
    'Alex',                             // 5: personaName
    'friendly',                         // 6: personaTone
    false,                              // 7: personaDirty
    false,                              // 8: personaSaving
    false,                              // 9: apiKeyExpanded
    '',                                 // 10: newApiKey
    false,                              // 11: apiKeyValidating
    '',                                 // 12: apiKeyError
    false,                              // 13: folderAdding
    'local',                            // 14: connectionMode
    '',                                 // 15: serverUrl
    '',                                 // 16: serverToken
    false,                              // 17: connectionSaving
    false,                              // 18: connectionTesting
    null,                               // 19: connectionTestResult
    '',                                 // 20: tokenLast4
    { gmail: false, calendar: false, drive: false },  // 21: integrationStatus
    null,                               // 22: connectingService
    null,                               // 23: disconnectConfirm
    null,                               // 24: toast
    null,                               // 25: memoryData
    false,                              // 26: memoryLoading
    '',                                 // 27: memorySearch
    null,                               // 28: memoryDeleteConfirm
    false,                              // 29: ltmCollapsed
    false,                              // 30: dailyCollapsed
    null,                               // 31: activityData
    false,                              // 32: activityLoading
    'all',                              // 33: activityFilter
    null,                               // 34: activityExpandedId
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

  it('renders loading skeleton when loading is true', () => {
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
    expect(json).toContain('Allgemein')
    expect(json).toContain('Integrationen')
    expect(json).toContain('Memory')
  })

  it('renders Allgemein tab by default with sub-component props', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    // Sub-components appear as props in serialized JSX
    expect(json).toContain('"currentModel":"anthropic/claude-sonnet-4-5"')
    expect(json).toContain('"provider":"anthropic"')
    expect(json).toContain('"name":"Alex"')
    expect(json).toContain('"tone":"friendly"')
    expect(json).toContain('"last4":"abcd"')
    expect(json).toContain('"/Users/test"')
  })

  it('renders Integrationen tab with integration cards', () => {
    makeLoadedSlots({ 2: 'integrationen' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('Gmail')
    expect(json).toContain('Google Calendar')
    expect(json).toContain('Google Drive')
    expect(json).toContain('E-Mails lesen und senden')
    expect(json).toContain('Termine verwalten')
    expect(json).toContain('Dateien in Google Drive')
    // Should NOT contain Allgemein sub-component props
    expect(json).not.toContain('"currentModel"')
  })

  it('passes memoryLoading prop to Memory tab', () => {
    makeLoadedSlots({ 2: 'memory', 26: true })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"memoryLoading":true')
    expect(json).not.toContain('"currentModel"')
  })

  it('passes memoryData as null when not loaded', () => {
    makeLoadedSlots({ 2: 'memory' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"memoryData":null')
  })

  it('passes memoryData with longTerm entries', () => {
    const memData = {
      longTerm: [{ id: 'Farbe', title: 'Farbe', content: 'Blau' }],
      daily: [],
    }
    makeLoadedSlots({ 2: 'memory', 25: memData })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"title":"Farbe"')
    expect(json).toContain('"content":"Blau"')
  })

  it('passes memoryData with daily entries', () => {
    const memData = {
      longTerm: [],
      daily: [{ date: '2026-02-17', entries: [{ id: '2026-02-17:0', content: 'Notiz eins' }] }],
    }
    makeLoadedSlots({ 2: 'memory', 25: memData })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"date":"2026-02-17"')
    expect(json).toContain('"content":"Notiz eins"')
  })

  it('passes memorySearch prop', () => {
    makeLoadedSlots({ 2: 'memory', 27: 'test' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"memorySearch":"test"')
  })

  it('passes memoryDeleteConfirm prop', () => {
    makeLoadedSlots({ 2: 'memory', 28: { type: 'longTerm', id: 'Farbe' } })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"memoryDeleteConfirm"')
    expect(json).toContain('"type":"longTerm"')
  })

  it('passes activityLoading prop to Aktivitaet tab', () => {
    makeLoadedSlots({ 2: 'aktivitaet', 32: true })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"activityLoading":true')
  })

  it('passes activityData with entries', () => {
    const actData = {
      entries: [{
        id: 'tu-1',
        toolName: 'web-search',
        category: 'web',
        description: 'Wetter Berlin',
        params: { query: 'Wetter Berlin' },
        timestamp: '2026-02-17T10:00:00Z',
      }],
      hasMore: false,
    }
    makeLoadedSlots({ 2: 'aktivitaet', 31: actData })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"toolName":"web-search"')
    expect(json).toContain('"description":"Wetter Berlin"')
  })

  it('passes activityFilter prop', () => {
    makeLoadedSlots({ 2: 'aktivitaet', 33: 'email' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"activityFilter":"email"')
  })

  it('passes hasMore in activityData', () => {
    const actData = {
      entries: [{
        id: 'tu-1',
        toolName: 'shell',
        category: 'shell',
        description: 'ls',
        params: {},
        timestamp: '2026-02-17T10:00:00Z',
      }],
      hasMore: true,
    }
    makeLoadedSlots({ 2: 'aktivitaet', 31: actData })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"hasMore":true')
  })

  it('passes activityExpandedId prop', () => {
    makeLoadedSlots({ 2: 'aktivitaet', 34: 'tu-1' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"activityExpandedId":"tu-1"')
  })

  it('model section receives current model prop', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"currentModel":"anthropic/claude-sonnet-4-5"')
    expect(json).toContain('"saving":false')
  })

  it('persona section receives tone and name props', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"name":"Alex"')
    expect(json).toContain('"tone":"friendly"')
    expect(json).toContain('"dirty":false')
  })

  it('persona dirty prop reflects state', () => {
    makeLoadedSlots({ 7: true }) // personaDirty = true
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"dirty":true')
  })

  it('api key section receives provider and last4', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"provider":"anthropic"')
    expect(json).toContain('"last4":"abcd"')
    expect(json).toContain('"expanded":false')
  })

  it('api key section shows expanded state', () => {
    makeLoadedSlots({ 9: true }) // apiKeyExpanded = true
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"expanded":true')
  })

  it('api key section passes error prop', () => {
    makeLoadedSlots({ 9: true, 12: 'Key ungueltig' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"error":"Key ungueltig"')
  })

  it('folder section receives paths', () => {
    makeLoadedSlots()
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"/Users/test"')
    expect(json).toContain('"homePath":"/Users/test"')
  })

  it('renders toast when toast state is set', () => {
    makeLoadedSlots({ 24: { message: 'Gespeichert', type: 'success' } })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"message":"Gespeichert"')
    expect(json).toContain('"show":true')
  })

  it('toast has show=false when toast state is null', () => {
    makeLoadedSlots({ 24: null })
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

  // Integration tests — serialized JSX shows props passed to IntegrationCard
  it('passes connected=false for all disconnected services', () => {
    makeLoadedSlots({ 2: 'integrationen', 21: { gmail: false, calendar: false, drive: false } })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    // All 3 cards have connected:false
    expect(json).toContain('"connected":false')
    expect(json).not.toContain('"connected":true')
  })

  it('passes connected=true when service is connected', () => {
    makeLoadedSlots({ 2: 'integrationen', 21: { gmail: true, calendar: false, drive: false } })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"connected":true')
  })

  it('passes connecting=true when connectingService is set', () => {
    makeLoadedSlots({ 2: 'integrationen', 22: 'gmail' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"connecting":true')
  })

  it('passes confirmDisconnect=true when disconnectConfirm is set', () => {
    makeLoadedSlots({ 2: 'integrationen', 21: { gmail: true, calendar: false, drive: false }, 23: 'gmail' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('"confirmDisconnect":true')
  })

  it('shows Outlook hint in Integrationen tab', () => {
    makeLoadedSlots({ 2: 'integrationen' })
    stateIndex = 0
    const result = Settings()
    const json = JSON.stringify(result)
    expect(json).toContain('Outlook')
  })
})
