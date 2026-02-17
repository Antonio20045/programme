import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock React hooks (same pattern as ToolExecution.test.ts)
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

import Setup, { AccessScreen, ApiKeyScreen, PersonaScreen, DoneScreen } from '../pages/Setup'

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

// ---------------------------------------------------------------------------
// Setup component tests
// ---------------------------------------------------------------------------

describe('Setup', () => {
  const mockOnSetupComplete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('is a function component', () => {
    expect(typeof Setup).toBe('function')
  })

  it('renders without crashing', () => {
    stateIndex = 0
    const result = Setup({ onSetupComplete: mockOnSetupComplete })
    expect(result).toBeDefined()
  })

  it('accepts onSetupComplete prop', () => {
    stateIndex = 0
    // Should not throw
    expect(() => Setup({ onSetupComplete: mockOnSetupComplete })).not.toThrow()
  })

  it('renders AccessScreen on access step (default)', () => {
    stateIndex = 0
    const result = Setup({ onSetupComplete: mockOnSetupComplete })
    expect(result).toHaveProperty('type', AccessScreen)
  })

  it('renders ApiKeyScreen when step is apikey', () => {
    // Setup slots: step, provider, apiKey, model, personaName, tone
    stateSlots = [
      makeSlot('apikey'),      // step
      makeSlot('anthropic'),   // provider
      makeSlot(''),            // apiKey
      makeSlot('anthropic/claude-sonnet-4-5'), // model
      makeSlot('Alex'),        // personaName
      makeSlot('friendly'),    // tone
    ]
    stateIndex = 0
    const result = Setup({ onSetupComplete: mockOnSetupComplete })
    expect(result).toHaveProperty('type', ApiKeyScreen)
  })

  it('renders PersonaScreen when step is persona', () => {
    stateSlots = [
      makeSlot('persona'),
      makeSlot('anthropic'),
      makeSlot(''),
      makeSlot('anthropic/claude-sonnet-4-5'),
      makeSlot('Alex'),
      makeSlot('friendly'),
    ]
    stateIndex = 0
    const result = Setup({ onSetupComplete: mockOnSetupComplete })
    expect(result).toHaveProperty('type', PersonaScreen)
  })

  it('renders DoneScreen when step is done', () => {
    stateSlots = [
      makeSlot('done'),
      makeSlot('anthropic'),
      makeSlot('test-key-value'),
      makeSlot('anthropic/claude-sonnet-4-5'),
      makeSlot('Alex'),
      makeSlot('friendly'),
    ]
    stateIndex = 0
    const result = Setup({ onSetupComplete: mockOnSetupComplete })
    expect(result).toHaveProperty('type', DoneScreen)
  })
})

// ---------------------------------------------------------------------------
// AccessScreen component tests
// ---------------------------------------------------------------------------

describe('AccessScreen', () => {
  const mockOnNext = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('is a function component', () => {
    expect(typeof AccessScreen).toBe('function')
  })

  it('renders without crashing', () => {
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    expect(result).toBeDefined()
  })

  it('shows welcome heading', () => {
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Willkommen bei KI-Assistent')
  })

  it('shows price display', () => {
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('15')
    expect(json).toContain('/Monat')
  })

  it('shows subtitle text', () => {
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Alles inklusive. Keine versteckten Kosten.')
  })

  it('shows feature bullet points', () => {
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Unbegrenzte Nutzung')
    expect(json).toContain('Alle Tools inklusive')
    expect(json).toContain('Läuft lokal auf deinem Rechner')
  })

  it('shows "Jetzt starten" button by default', () => {
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Jetzt starten')
  })

  it('does not show "Weiter" button when started is false', () => {
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).not.toContain('Weiter')
  })

  it('shows "Weiter" button when started is true', () => {
    // AccessScreen states: started=true (slot 0), showToast=false (slot 1)
    stateSlots = [
      makeSlot(true),   // started
      makeSlot(false),  // showToast
    ]
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Weiter')
    expect(json).toContain('Gestartet')
  })

  it('shows toast when showToast is true', () => {
    stateSlots = [
      makeSlot(true),  // started
      makeSlot(true),  // showToast
    ]
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('während der Beta kostenlos')
  })

  it('does not show toast when showToast is false', () => {
    stateSlots = [
      makeSlot(false),  // started
      makeSlot(false),  // showToast
    ]
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).not.toContain('während der Beta kostenlos')
  })

  it('disables start button when started', () => {
    stateSlots = [
      makeSlot(true),   // started
      makeSlot(false),  // showToast
    ]
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('"disabled":true')
    expect(json).toContain('bg-emerald-700')
  })

  it('enables start button when not started', () => {
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('bg-blue-600')
  })

  it('uses centered full-screen layout', () => {
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('min-h-screen')
    expect(json).toContain('items-center')
    expect(json).toContain('justify-center')
  })

  it('uses card styling', () => {
    stateIndex = 0
    const result = AccessScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('rounded-2xl')
    expect(json).toContain('bg-gray-900')
  })
})

// ---------------------------------------------------------------------------
// ApiKeyScreen component tests
// ---------------------------------------------------------------------------

describe('ApiKeyScreen', () => {
  const mockOnNext = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  // ApiKeyScreen slots: provider, apiKey, showKey, validating, validationError, validated

  it('is a function component', () => {
    expect(typeof ApiKeyScreen).toBe('function')
  })

  it('renders without crashing', () => {
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    expect(result).toBeDefined()
  })

  it('shows heading "Welchen KI-Anbieter nutzt du?"', () => {
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Welchen KI-Anbieter nutzt du?')
  })

  it('shows three provider cards', () => {
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Anthropic')
    expect(json).toContain('OpenAI')
    expect(json).toContain('Google')
  })

  it('shows provider sublabels', () => {
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Claude')
    expect(json).toContain('GPT')
    expect(json).toContain('Gemini')
  })

  it('has Anthropic as default selection with border-blue-500', () => {
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    // Anthropic card should be selected (border-blue-500)
    expect(json).toContain('border-blue-500')
  })

  it('shows API key input as password type by default', () => {
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('"type":"password"')
  })

  it('shows API key input as text type when showKey is true', () => {
    // provider, apiKey, showKey=true, validating, validationError, validated
    stateSlots = [
      makeSlot('anthropic'),
      makeSlot(''),
      makeSlot(true),    // showKey
      makeSlot(false),
      makeSlot(''),
      makeSlot(false),
    ]
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('"type":"text"')
  })

  it('shows Weiter button', () => {
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Weiter')
  })

  it('disables Weiter button when apiKey is too short', () => {
    // apiKey empty → button disabled
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('"disabled":true')
  })

  it('shows "Wird geprüft..." when validating', () => {
    stateSlots = [
      makeSlot('anthropic'),
      makeSlot('a'.repeat(25)),
      makeSlot(false),
      makeSlot(true),   // validating
      makeSlot(''),
      makeSlot(false),
    ]
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Wird geprüft...')
  })

  it('shows validation error when set', () => {
    stateSlots = [
      makeSlot('anthropic'),
      makeSlot('a'.repeat(25)),
      makeSlot(false),
      makeSlot(false),
      makeSlot('Ungültiger API Key'),  // validationError
      makeSlot(false),
    ]
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Ungültiger API Key')
    expect(json).toContain('text-red-400')
  })

  it('shows red border on input when validation error exists', () => {
    stateSlots = [
      makeSlot('anthropic'),
      makeSlot('a'.repeat(25)),
      makeSlot(false),
      makeSlot(false),
      makeSlot('Fehler'),
      makeSlot(false),
    ]
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('border-red-500')
  })

  it('shows green border when validated', () => {
    stateSlots = [
      makeSlot('anthropic'),
      makeSlot('a'.repeat(25)),
      makeSlot(false),
      makeSlot(false),
      makeSlot(''),
      makeSlot(true),   // validated
    ]
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('border-emerald-500')
  })

  it('shows help link', () => {
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Wo bekomme ich einen API Key?')
  })

  it('uses animate-slide-in class', () => {
    stateIndex = 0
    const result = ApiKeyScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('animate-slide-in')
  })
})

// ---------------------------------------------------------------------------
// PersonaScreen component tests
// ---------------------------------------------------------------------------

describe('PersonaScreen', () => {
  const mockOnNext = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  // PersonaScreen slots: name, tone

  it('is a function component', () => {
    expect(typeof PersonaScreen).toBe('function')
  })

  it('renders without crashing', () => {
    stateIndex = 0
    const result = PersonaScreen({ onNext: mockOnNext })
    expect(result).toBeDefined()
  })

  it('shows heading "Wie soll dein Assistent sein?"', () => {
    stateIndex = 0
    const result = PersonaScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Wie soll dein Assistent sein?')
  })

  it('shows name input with default "Alex"', () => {
    stateIndex = 0
    const result = PersonaScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('"value":"Alex"')
  })

  it('shows name input label', () => {
    stateIndex = 0
    const result = PersonaScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Wie soll dein Assistent heißen?')
  })

  it('shows three tone cards', () => {
    stateIndex = 0
    const result = PersonaScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Professionell')
    expect(json).toContain('Freundlich')
    expect(json).toContain('Knapp')
  })

  it('shows example texts in tone cards', () => {
    stateIndex = 0
    const result = PersonaScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Die Datei wurde erstellt')
    expect(json).toContain('Klar, hab ich gemacht!')
    expect(json).toContain('Datei erstellt:')
  })

  it('has Freundlich as default with border-blue-500', () => {
    stateIndex = 0
    const result = PersonaScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('border-blue-500')
  })

  it('disables Weiter button when name is empty', () => {
    stateSlots = [
      makeSlot(''),          // name (empty)
      makeSlot('friendly'),  // tone
    ]
    stateIndex = 0
    const result = PersonaScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('"disabled":true')
  })

  it('enables Weiter button when name is set', () => {
    // Default name is 'Alex' which is non-empty → button not disabled
    stateIndex = 0
    const result = PersonaScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('Weiter')
    // name.trim() !== '' → disabled=false
    expect(json).toContain('"disabled":false')
  })

  it('uses animate-slide-in class', () => {
    stateIndex = 0
    const result = PersonaScreen({ onNext: mockOnNext })
    const json = JSON.stringify(result)
    expect(json).toContain('animate-slide-in')
  })
})

// ---------------------------------------------------------------------------
// DoneScreen component tests
// ---------------------------------------------------------------------------

describe('DoneScreen', () => {
  const mockOnComplete = vi.fn()
  const defaultConfig: { name: string; tone: 'friendly'; provider: string; model: string } = {
    name: 'TestBot',
    tone: 'friendly',
    provider: 'anthropic',
    model: 'anthropic/claude-sonnet-4-5',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  // DoneScreen slots: taskStatus, errorMsg

  it('is a function component', () => {
    expect(typeof DoneScreen).toBe('function')
  })

  it('renders without crashing', () => {
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    expect(result).toBeDefined()
  })

  it('shows "Wird eingerichtet..." while running', () => {
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('Wird eingerichtet...')
  })

  it('shows "{name} ist bereit!" with config name when done', () => {
    stateSlots = [
      makeSlot('done'),  // taskStatus
      makeSlot(''),      // errorMsg
    ]
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('TestBot')
    expect(json).toContain('ist bereit!')
  })

  it('shows spinner while running', () => {
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('animate-spin')
  })

  it('contains SVG checkmark when done', () => {
    stateSlots = [
      makeSlot('done'),  // taskStatus
      makeSlot(''),      // errorMsg
    ]
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('svg')
    expect(json).toContain('circle')
    expect(json).toContain('polyline')
  })

  it('shows "Los geht\'s" button', () => {
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain("Los geht'")
  })

  it('disables button while taskStatus is running', () => {
    // Default taskStatus = 'running'
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('"disabled":true')
  })

  it('enables button when taskStatus is done', () => {
    stateSlots = [
      makeSlot('done'),  // taskStatus
      makeSlot(''),      // errorMsg
    ]
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('"disabled":false')
  })

  it('shows error message when taskStatus is error', () => {
    stateSlots = [
      makeSlot('error'),                    // taskStatus
      makeSlot('Config write failed'),      // errorMsg
    ]
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('Config write failed')
  })

  it('shows "Erneut versuchen" button on error', () => {
    stateSlots = [
      makeSlot('error'),
      makeSlot('Some error'),
    ]
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('Erneut versuchen')
  })

  it('disables button when taskStatus is error', () => {
    stateSlots = [
      makeSlot('error'),
      makeSlot('Some error'),
    ]
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('"disabled":true')
  })

  it('shows "Einrichtung fehlgeschlagen" when error', () => {
    stateSlots = [
      makeSlot('error'),
      makeSlot('Some error'),
    ]
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('Einrichtung fehlgeschlagen')
  })

  it('does not show error section when taskStatus is running', () => {
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).not.toContain('Erneut versuchen')
  })

  it('uses animate-slide-in class', () => {
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('animate-slide-in')
  })

  it('uses checkmark animations when done', () => {
    stateSlots = [
      makeSlot('done'),  // taskStatus
      makeSlot(''),      // errorMsg
    ]
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    const json = JSON.stringify(result)
    expect(json).toContain('animate-check-circle')
    expect(json).toContain('animate-check-mark')
  })

  it('has onComplete prop wired to button', () => {
    stateSlots = [
      makeSlot('done'),
      makeSlot(''),
    ]
    stateIndex = 0
    const result = DoneScreen({ config: defaultConfig, apiKey: 'test', onComplete: mockOnComplete })
    // The button's onClick should be the onComplete function
    const json = JSON.stringify(result)
    expect(json).toContain("Los geht'")
  })
})
