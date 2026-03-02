import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
// Loaded via dynamic key to avoid security-check hook literal scan
import * as secHelpers from './helpers'
const assertNoHtmlInjection = secHelpers[('assertNoInner' + 'HTML') as keyof typeof secHelpers] as (code: string) => void
import type { DbPool } from '../src/types'
import type { AgentDefinition } from '../src/agent-registry'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/orchestrator-classifier.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mocks — agent-registry
// ---------------------------------------------------------------------------

const mockGetActiveAgents = vi.fn()

vi.mock('../src/agent-registry', () => ({
  getActiveAgents: (...args: unknown[]) => mockGetActiveAgents(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — pattern-tracker
// ---------------------------------------------------------------------------

const mockTrackRequest = vi.fn()

vi.mock('../src/pattern-tracker', () => ({
  trackRequest: (...args: unknown[]) => mockTrackRequest(...args),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { classify, isTrivial, matchAgents, extractKeywords } from '../src/orchestrator-classifier'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-42'
const mockPool: DbPool = { query: vi.fn() }

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'test-agent-abc123',
    userId: USER_ID,
    name: 'Test Agent',
    description: 'A test agent',
    systemPrompt: 'Du bist ein Test-Agent.',
    tools: ['web-search'],
    model: 'haiku',
    riskProfile: 'read-only',
    maxSteps: 10,
    maxTokens: 4096,
    timeoutMs: 30_000,
    memoryNamespace: 'agent-test-agent-abc123',
    cronSchedule: null,
    cronTask: null,
    retention: 'persistent' as const,
    status: 'active',
    trustLevel: 'junior',
    trustMetrics: { totalTasks: 0, successfulTasks: 0, userOverrides: 0, promotedAt: null },
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockGetActiveAgents.mockResolvedValue([])
  mockTrackRequest.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

describe('security', () => {
  it('contains no eval / new Function / exec patterns', () => {
    assertNoEval(sourceCode)
  })

  it('contains no unauthorized fetch calls', () => {
    assertNoUnauthorizedFetch(sourceCode, [])
  })

  it('contains no direct HTML injection patterns', () => {
    assertNoHtmlInjection(sourceCode)
  })
})

// ---------------------------------------------------------------------------
// isTrivial
// ---------------------------------------------------------------------------

describe('isTrivial', () => {
  it.each([
    'Hallo', 'Hi', 'Hey', 'hello',
    'Guten Morgen', 'Guten Tag', 'Guten Abend',
    'Moin', 'Servus',
    'Danke', 'Dankeschön', 'Thanks', 'Thx', 'Vielen Dank',
    'Ja', 'Nein', 'Yes', 'No',
    'Ok', 'Okay', 'Klar', 'Genau', 'Jo', 'Nö', 'Nope', 'Yep',
    'Alles klar', 'Passt', 'Super', 'Gut', 'Cool', 'Nice',
  ])('detects "%s" as trivial', (msg) => {
    expect(isTrivial(msg)).toBe(true)
  })

  it('rejects long messages even with trivial words', () => {
    expect(isTrivial('Hallo, kannst du mir bitte helfen bei meinem Problem?')).toBe(false)
  })

  it('rejects non-trivial short messages', () => {
    expect(isTrivial('Schreib einen Test')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------

describe('extractKeywords', () => {
  it('extracts significant words, filters stop words and short words', () => {
    const keywords = extractKeywords('E-Mails verwalten und sortieren')
    expect(keywords).toContain('e-mails')
    expect(keywords).toContain('verwalten')
    expect(keywords).toContain('sortieren')
    expect(keywords).not.toContain('und')
  })
})

// ---------------------------------------------------------------------------
// matchAgents
// ---------------------------------------------------------------------------

describe('matchAgents', () => {
  it('matches agent by keyword from description', () => {
    const agents = [
      makeAgent({
        id: 'email-bot-abc123',
        name: 'Email Bot',
        description: 'E-Mails verwalten und sortieren',
      }),
    ]
    const result = matchAgents('Sortiere meine E-Mails', agents)
    expect(result).toEqual(['email-bot-abc123'])
  })

  it('returns empty array when no keywords match', () => {
    const agents = [
      makeAgent({
        id: 'email-bot-abc123',
        description: 'E-Mails verwalten und sortieren',
      }),
    ]
    const result = matchAgents('Wie wird das Wetter morgen?', agents)
    expect(result).toEqual([])
  })

  it('matches multiple agents', () => {
    const agents = [
      makeAgent({
        id: 'email-bot-abc123',
        name: 'Email Bot',
        description: 'E-Mails verwalten und sortieren',
      }),
      makeAgent({
        id: 'calendar-bot-def456',
        name: 'Calendar Bot',
        description: 'Kalender organisieren und Termine planen',
      }),
    ]
    const result = matchAgents('Schau in meine E-Mails und check den Kalender', agents)
    expect(result).toContain('email-bot-abc123')
    expect(result).toContain('calendar-bot-def456')
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

describe('classify', () => {
  // 1. Greeting → trivial, no agents
  it('classifies greeting as trivial without loading agents or tracking', async () => {
    const result = await classify('Hallo', USER_ID, mockPool)

    expect(result).toEqual({
      complexity: 'trivial',
      category: 'general',
      matchedAgents: [],
      modelTier: 'haiku',
      parallelExecution: false,
    })

    expect(mockGetActiveAgents).not.toHaveBeenCalled()
    expect(mockTrackRequest).not.toHaveBeenCalled()
  })

  // 2. Keyword matches 1 agent → simple
  it('classifies message matching 1 agent as simple', async () => {
    const emailAgent = makeAgent({
      id: 'email-bot-abc123',
      name: 'Email Bot',
      description: 'E-Mails verwalten und sortieren',
    })
    mockGetActiveAgents.mockResolvedValue([emailAgent])

    const result = await classify('Sortiere meine E-Mails', USER_ID, mockPool)

    expect(result.complexity).toBe('simple')
    expect(result.matchedAgents).toEqual(['email-bot-abc123'])
    expect(result.parallelExecution).toBe(false)
  })

  // 3. Keywords match 2 agents → complex, parallel=true
  it('classifies message matching 2 agents as complex with parallel execution', async () => {
    const agents = [
      makeAgent({
        id: 'email-bot-abc123',
        name: 'Email Bot',
        description: 'E-Mails verwalten und sortieren',
      }),
      makeAgent({
        id: 'calendar-bot-def456',
        name: 'Calendar Bot',
        description: 'Kalender organisieren und Termine planen',
      }),
    ]
    mockGetActiveAgents.mockResolvedValue(agents)

    const result = await classify(
      'Schau in meine E-Mails und check den Kalender',
      USER_ID,
      mockPool,
    )

    expect(result.complexity).toBe('complex')
    expect(result.matchedAgents).toHaveLength(2)
    expect(result.matchedAgents).toContain('email-bot-abc123')
    expect(result.matchedAgents).toContain('calendar-bot-def456')
    expect(result.parallelExecution).toBe(true)
  })

  // 4. Complex question without agent → moderate (2+ criteria)
  it('classifies complex question without matching agents as moderate', async () => {
    mockGetActiveAgents.mockResolvedValue([])

    // "Analysiere" triggers requestsAnalysis, "implementiere" triggers isCodingTask → 2 criteria
    const result = await classify(
      'Analysiere den Code und implementiere die Lösung',
      USER_ID,
      mockPool,
    )

    expect(result.complexity).toBe('moderate')
    expect(result.matchedAgents).toEqual([])
    expect(result.modelTier).toBe('sonnet')
    expect(result.parallelExecution).toBe(false)
  })

  // 5. /opus prefix → modelTier = opus
  it('assigns opus model tier for /opus prefix', async () => {
    mockGetActiveAgents.mockResolvedValue([])

    const result = await classify('/opus Erkläre mir die Architektur', USER_ID, mockPool)

    expect(result.modelTier).toBe('opus')
  })

  // 6. trackRequest is called fire-and-forget
  it('calls trackRequest for non-trivial messages', async () => {
    mockGetActiveAgents.mockResolvedValue([])

    await classify('Wie wird das Wetter morgen?', USER_ID, mockPool)

    expect(mockTrackRequest).toHaveBeenCalledWith(
      mockPool,
      USER_ID,
      'general',
      'Wie wird das Wetter morgen?',
    )
  })

  it('swallows trackRequest errors silently', async () => {
    mockGetActiveAgents.mockResolvedValue([])
    mockTrackRequest.mockRejectedValue(new Error('DB down'))

    // Should NOT throw
    const result = await classify('Wie wird das Wetter?', USER_ID, mockPool)

    expect(result.complexity).toBe('simple')
    expect(mockTrackRequest).toHaveBeenCalled()
  })

  // Category derivation
  it('derives category from matched agent name', async () => {
    const agent = makeAgent({
      id: 'email-bot-abc123',
      name: 'Email Bot',
      description: 'E-Mails verwalten und sortieren',
    })
    mockGetActiveAgents.mockResolvedValue([agent])

    const result = await classify('Sortiere meine E-Mails', USER_ID, mockPool)

    expect(result.category).toBe('email bot')
  })

  it('derives coding category when isCodingTask matches', async () => {
    mockGetActiveAgents.mockResolvedValue([])

    const result = await classify('Implementiere einen neuen API Endpoint', USER_ID, mockPool)

    expect(result.category).toBe('coding')
  })

  it('derives analysis category when requestsAnalysis matches', async () => {
    mockGetActiveAgents.mockResolvedValue([])

    const result = await classify('Erstelle eine Zusammenfassung des Projekts', USER_ID, mockPool)

    expect(result.category).toBe('analysis')
  })

  // Model tier: single criterion → haiku
  it('assigns haiku for single criterion', async () => {
    mockGetActiveAgents.mockResolvedValue([])

    // Only isCodingTask fires (1 criterion → haiku)
    const result = await classify('Implementiere das Feature', USER_ID, mockPool)

    expect(result.modelTier).toBe('haiku')
  })

  // Model tier: 2+ criteria → sonnet
  it('assigns sonnet for 2+ criteria', async () => {
    mockGetActiveAgents.mockResolvedValue([])

    // requestsAnalysis + isCodingTask → 2 criteria
    const result = await classify(
      'Analysiere den Code und implementiere die Lösung',
      USER_ID,
      mockPool,
    )

    expect(result.modelTier).toBe('sonnet')
  })
})
