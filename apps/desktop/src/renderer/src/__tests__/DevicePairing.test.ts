import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock React hooks (same pattern as Settings.test.ts)
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
  useEffect: (_fn: () => void | (() => void)) => {
    // no-op in unit tests
  },
  useRef: <T,>(initial: T) => ({ current: initial }),
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

import DevicePairing from '../components/DevicePairing'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(): void {
  stateSlots = []
  stateIndex = 0
}

function makeSlot<T>(value: T): StateSlot<T> {
  return { value, setter: vi.fn() } as StateSlot<T>
}

/**
 * Build state slots for DevicePairing.
 * Slot order matches useState calls in DevicePairing():
 *  0: state (PairingState)
 *  1: loading
 *  2: qrDataUrl
 *  3: expiresAt
 *  4: countdown
 *  5: safeStorageAvailable
 *  6: partnerDeviceId
 *  7: pairedAt
 *  8: confirmUnpair
 *  9: unpairLoading
 */
function makeSlots(overrides: Partial<Record<number, unknown>> = {}): void {
  const defaults: unknown[] = [
    'idle',   // 0: state
    false,    // 1: loading
    '',       // 2: qrDataUrl
    0,        // 3: expiresAt
    '',       // 4: countdown
    true,     // 5: safeStorageAvailable
    '',       // 6: partnerDeviceId
    '',       // 7: pairedAt
    false,    // 8: confirmUnpair
    false,    // 9: unpairLoading
  ]
  for (const [idx, val] of Object.entries(overrides)) {
    defaults[Number(idx)] = val
  }
  stateSlots = defaults.map((v) => makeSlot(v))
}

const mockShowToast = vi.fn()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DevicePairing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('is a function component', () => {
    expect(typeof DevicePairing).toBe('function')
  })

  it('exports a default function named DevicePairing', () => {
    expect(DevicePairing.name).toBe('DevicePairing')
  })

  // -------------------------------------------------------------------------
  // Loading skeleton
  // -------------------------------------------------------------------------

  it('renders loading skeleton when loading is true', () => {
    makeSlots({ 1: true })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('animate-pulse')
    expect(json).toContain('rounded-xl')
  })

  it('loading skeleton does not show any action button', () => {
    makeSlots({ 1: true })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).not.toContain('Gerät verbinden')
    expect(json).not.toContain('QR-Code')
  })

  // -------------------------------------------------------------------------
  // Idle state
  // -------------------------------------------------------------------------

  it('renders idle state with "Mobilgerät verbinden" heading', () => {
    makeSlots()
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Mobilgerät verbinden')
  })

  it('idle state shows connect button', () => {
    makeSlots()
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Gerät verbinden')
  })

  it('idle state button has correct styling classes', () => {
    makeSlots()
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('bg-blue-600')
    expect(json).toContain('font-semibold')
    expect(json).toContain('transition-colors')
  })

  it('idle state shows description text', () => {
    makeSlots()
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('QR-Code')
  })

  it('idle state uses SectionCard pattern (rounded-xl border-gray-800 bg-gray-900 p-6)', () => {
    makeSlots()
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('rounded-xl')
    expect(json).toContain('border-gray-800')
    expect(json).toContain('bg-gray-900')
    expect(json).toContain('p-6')
  })

  // -------------------------------------------------------------------------
  // QR state
  // -------------------------------------------------------------------------

  it('renders QR state with heading', () => {
    makeSlots({ 0: 'qr', 2: 'data:image/png;base64,abc', 4: '4:59' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('QR-Code scannen')
  })

  it('QR state shows img with alt text', () => {
    makeSlots({ 0: 'qr', 2: 'data:image/png;base64,abc', 4: '4:59' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Pairing QR-Code')
    expect(json).toContain('data:image/png;base64,abc')
  })

  it('QR state shows waiting indicator', () => {
    makeSlots({ 0: 'qr', 2: 'data:image/png;base64,abc', 4: '4:59' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Warte auf Verbindung')
  })

  it('QR state shows countdown', () => {
    makeSlots({ 0: 'qr', 2: 'data:image/png;base64,abc', 4: '4:59' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('4:59')
  })

  it('QR state shows cancel button', () => {
    makeSlots({ 0: 'qr', 2: 'data:image/png;base64,abc', 4: '4:59' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Abbrechen')
  })

  it('QR state cancel button has border styling', () => {
    makeSlots({ 0: 'qr', 2: 'data:image/png;base64,abc', 4: '4:59' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('border-gray-700')
    expect(json).toContain('text-gray-300')
    expect(json).toContain('transition-colors')
  })

  it('QR state does not show expired message', () => {
    makeSlots({ 0: 'qr', 2: 'data:image/png;base64,abc', 4: '4:59' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).not.toContain('Code abgelaufen')
  })

  it('QR state image has no opacity class', () => {
    makeSlots({ 0: 'qr', 2: 'data:image/png;base64,abc', 4: '4:59' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).not.toContain('opacity-30')
  })

  // -------------------------------------------------------------------------
  // Expired state
  // -------------------------------------------------------------------------

  it('expired state shows "Code abgelaufen" message', () => {
    makeSlots({ 0: 'expired', 2: 'data:image/png;base64,abc' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Code abgelaufen')
  })

  it('expired state shows retry button', () => {
    makeSlots({ 0: 'expired', 2: 'data:image/png;base64,abc' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Neuen Code erstellen')
  })

  it('expired state image is dimmed with opacity-30', () => {
    makeSlots({ 0: 'expired', 2: 'data:image/png;base64,abc' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('opacity-30')
  })

  it('expired state does not show cancel button', () => {
    makeSlots({ 0: 'expired', 2: 'data:image/png;base64,abc' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).not.toContain('Abbrechen')
  })

  it('expired state retry button has primary styling', () => {
    makeSlots({ 0: 'expired', 2: 'data:image/png;base64,abc' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('bg-blue-600')
    expect(json).toContain('font-semibold')
    expect(json).toContain('transition-colors')
  })

  // -------------------------------------------------------------------------
  // SafeStorage warning
  // -------------------------------------------------------------------------

  it('QR state shows SafeStorage warning when unavailable', () => {
    makeSlots({ 0: 'qr', 2: 'data:image/png;base64,abc', 4: '4:59', 5: false })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Kein OS-Keyring')
    expect(json).toContain('yellow-400')
    expect(json).toContain('yellow-900')
  })

  it('QR state does not show SafeStorage warning when available', () => {
    makeSlots({ 0: 'qr', 2: 'data:image/png;base64,abc', 4: '4:59', 5: true })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).not.toContain('Kein OS-Keyring')
  })

  it('expired state shows SafeStorage warning when unavailable', () => {
    makeSlots({ 0: 'expired', 2: 'data:image/png;base64,abc', 5: false })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Kein OS-Keyring')
  })

  // -------------------------------------------------------------------------
  // Paired state
  // -------------------------------------------------------------------------

  it('paired state shows "Mobilgerät" heading', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Mobilgerät')
  })

  it('paired state shows "Verbunden" badge', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Verbunden')
    expect(json).toContain('emerald-900')
    expect(json).toContain('emerald-300')
  })

  it('paired state shows device ID truncated', () => {
    const id = 'abcd1234efgh5678'
    makeSlots({ 0: 'paired', 6: id, 7: '2026-01-15T00:00:00.000Z' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Geräte-ID')
    expect(json).toContain('abcd1234')
    expect(json).toContain('efgh5678')
  })

  it('paired state shows pairedAt date when set', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Verbunden seit')
  })

  it('paired state does not show date when pairedAt is empty', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '' })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).not.toContain('Verbunden seit')
  })

  it('paired state shows "Verbindung trennen" button when not confirming', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z', 8: false })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Verbindung trennen')
  })

  it('paired state "Verbindung trennen" has red text styling', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z', 8: false })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('text-red-400')
    expect(json).toContain('border-gray-700')
    expect(json).toContain('transition-colors')
  })

  // -------------------------------------------------------------------------
  // Paired state — confirm unpair
  // -------------------------------------------------------------------------

  it('shows confirm buttons when confirmUnpair is true', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z', 8: true })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Wirklich trennen')
    expect(json).toContain('Abbrechen')
  })

  it('confirm unpair button has red filled styling', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z', 8: true })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('bg-red-600')
    expect(json).toContain('font-semibold')
    expect(json).toContain('transition-colors')
  })

  it('confirm unpair button has multiple children when unpairLoading is true (spinner + label)', () => {
    // SpinnerSmall is a local component — in the React mock it serializes as a bare
    // JSX element without expanded SVG internals. We verify the button children are an
    // array (spinner + text) rather than just a string, by checking the button is
    // disabled and the label still appears.
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z', 8: true, 9: true })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('"disabled":true')
    expect(json).toContain('Wirklich trennen')
  })

  it('confirm unpair button is disabled when unpairLoading', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z', 8: true, 9: true })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('disabled:opacity-50')
  })

  it('does not show initial "Verbindung trennen" when confirmUnpair is true', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z', 8: true })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).not.toContain('Verbindung trennen')
    expect(json).toContain('Wirklich trennen')
  })

  it('paired state shows SafeStorage warning when unavailable', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z', 5: false })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).toContain('Kein OS-Keyring')
    expect(json).toContain('yellow-400')
  })

  it('paired state does not show SafeStorage warning when available', () => {
    makeSlots({ 0: 'paired', 6: 'abc123', 7: '2026-01-15T00:00:00.000Z', 5: true })
    stateIndex = 0
    const result = DevicePairing({ showToast: mockShowToast })
    const json = JSON.stringify(result)
    expect(json).not.toContain('Kein OS-Keyring')
  })

  // -------------------------------------------------------------------------
  // Structural / shared
  // -------------------------------------------------------------------------

  it('all states use rounded-xl border border-gray-800 bg-gray-900 p-6 card pattern', () => {
    const states = ['idle', 'qr', 'expired', 'paired'] as const
    for (const s of states) {
      resetState()
      makeSlots({
        0: s,
        1: false,
        2: s !== 'idle' ? 'data:image/png;base64,abc' : '',
        4: s === 'qr' ? '4:59' : '',
        6: s === 'paired' ? 'abc123' : '',
        7: s === 'paired' ? '2026-01-15T00:00:00.000Z' : '',
      })
      stateIndex = 0
      const result = DevicePairing({ showToast: mockShowToast })
      const json = JSON.stringify(result)
      expect(json, `state=${s}`).toContain('rounded-xl')
      expect(json, `state=${s}`).toContain('border-gray-800')
      expect(json, `state=${s}`).toContain('bg-gray-900')
      expect(json, `state=${s}`).toContain('p-6')
    }
  })

  it('heading uses text-lg font-semibold text-gray-100 in all states', () => {
    const states = ['idle', 'qr', 'expired', 'paired'] as const
    for (const s of states) {
      resetState()
      makeSlots({
        0: s,
        1: false,
        2: s !== 'idle' ? 'data:image/png;base64,abc' : '',
        4: s === 'qr' ? '4:59' : '',
        6: s === 'paired' ? 'abc123' : '',
        7: s === 'paired' ? '2026-01-15T00:00:00.000Z' : '',
      })
      stateIndex = 0
      const result = DevicePairing({ showToast: mockShowToast })
      const json = JSON.stringify(result)
      expect(json, `state=${s}`).toContain('text-lg')
      expect(json, `state=${s}`).toContain('font-semibold')
      expect(json, `state=${s}`).toContain('text-gray-100')
    }
  })
})
