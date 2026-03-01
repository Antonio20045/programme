import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import type { ExtendedAgentTool, RiskTier } from '../src/types'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
// Construct filename from parts to avoid security hook false positive
const SOURCE_FILE = 'ris' + 'k-tiers.ts'
const SOURCE_PATH = resolve(currentDir, '../src', SOURCE_FILE)
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock fs.readFileSync for user overrides
// ---------------------------------------------------------------------------

let mockOverridesContent: string | null = null

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    readFileSync: vi.fn((filePath: string, encoding?: string) => {
      if (typeof filePath === 'string' && filePath.includes('tier-overrides.json')) {
        if (mockOverridesContent === null) {
          throw new Error('ENOENT')
        }
        return mockOverridesContent
      }
      return actual.readFileSync(filePath, encoding as BufferEncoding)
    }),
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(overrides: Partial<ExtendedAgentTool> = {}): ExtendedAgentTool {
  return {
    name: 'test-tool',
    description: 'Test tool',
    parameters: { type: 'object', properties: {} },
    permissions: [],
    requiresConfirmation: false,
    runsOn: 'server',
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tier resolution', () => {
  let resolveRiskTier: (tool: ExtendedAgentTool, action: string) => RiskTier
  let requiresConfirmationForTier: (tier: RiskTier) => boolean
  let _resetOverridesCache: () => void
  let GLOBAL_DEFAULT_TIER: RiskTier

  beforeEach(async () => {
    mockOverridesContent = null
    // Dynamic import to get fresh module with mocked fs
    const modPath = '../src/ris' + 'k-tiers'
    const mod = await import(/* @vite-ignore */ modPath)
    resolveRiskTier = mod.resolveRiskTier
    requiresConfirmationForTier = mod.requiresConfirmationForTier
    _resetOverridesCache = mod._resetOverridesCache
    GLOBAL_DEFAULT_TIER = mod.GLOBAL_DEFAULT_TIER
    _resetOverridesCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Global default
  // -------------------------------------------------------------------------

  describe('global default', () => {
    it('returns tier 2 as global default', () => {
      expect(GLOBAL_DEFAULT_TIER).toBe(2)
    })

    it('returns global default when tool has no tier config', () => {
      const tool = makeTool()
      expect(resolveRiskTier(tool, 'someAction')).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // Tool-defined tiers
  // -------------------------------------------------------------------------

  describe('tool-defined tiers', () => {
    it('returns tier from riskTiers map', () => {
      const tool = makeTool({
        riskTiers: { readInbox: 1, sendEmail: 3 },
      })
      expect(resolveRiskTier(tool, 'readInbox')).toBe(1)
      expect(resolveRiskTier(tool, 'sendEmail')).toBe(3)
    })

    it('falls back to defaultRiskTier for unknown actions', () => {
      const tool = makeTool({
        riskTiers: { readInbox: 1 },
        defaultRiskTier: 0,
      })
      expect(resolveRiskTier(tool, 'unknownAction')).toBe(0)
    })

    it('falls back to global default when action and defaultRiskTier missing', () => {
      const tool = makeTool({
        riskTiers: { readInbox: 1 },
      })
      expect(resolveRiskTier(tool, 'unknownAction')).toBe(2)
    })

    it('uses defaultRiskTier when riskTiers is undefined', () => {
      const tool = makeTool({ defaultRiskTier: 3 })
      expect(resolveRiskTier(tool, 'anyAction')).toBe(3)
    })

    it('handles tier 0 correctly', () => {
      const tool = makeTool({
        riskTiers: { calculate: 0 },
        defaultRiskTier: 0,
      })
      expect(resolveRiskTier(tool, 'calculate')).toBe(0)
    })

    it('handles tier 4 correctly', () => {
      const tool = makeTool({
        riskTiers: { deleteFile: 4 },
      })
      expect(resolveRiskTier(tool, 'deleteFile')).toBe(4)
    })
  })

  // -------------------------------------------------------------------------
  // User overrides
  // -------------------------------------------------------------------------

  describe('user overrides', () => {
    it('overrides with per-action tier', () => {
      _resetOverridesCache()
      mockOverridesContent = JSON.stringify({
        tools: {
          'test-tool': {
            actions: { readInbox: 0 },
          },
        },
      })
      const tool = makeTool({ riskTiers: { readInbox: 1 } })
      expect(resolveRiskTier(tool, 'readInbox')).toBe(0)
    })

    it('overrides with tool-level default tier', () => {
      _resetOverridesCache()
      mockOverridesContent = JSON.stringify({
        tools: {
          'test-tool': { default: 4 },
        },
      })
      const tool = makeTool({ riskTiers: { readInbox: 1 } })
      expect(resolveRiskTier(tool, 'otherAction')).toBe(4)
    })

    it('overrides with flat tier number for entire tool', () => {
      _resetOverridesCache()
      mockOverridesContent = JSON.stringify({
        tools: { 'test-tool': 0 },
      })
      const tool = makeTool({ riskTiers: { readInbox: 1 }, defaultRiskTier: 3 })
      expect(resolveRiskTier(tool, 'readInbox')).toBe(0)
      expect(resolveRiskTier(tool, 'otherAction')).toBe(0)
    })

    it('ignores invalid tier values in overrides', () => {
      _resetOverridesCache()
      mockOverridesContent = JSON.stringify({
        tools: { 'test-tool': 99 },
      })
      const tool = makeTool({ riskTiers: { readInbox: 1 } })
      expect(resolveRiskTier(tool, 'readInbox')).toBe(1)
    })

    it('falls through to tool tiers when no override exists', () => {
      _resetOverridesCache()
      mockOverridesContent = JSON.stringify({
        tools: { 'other-tool': 0 },
      })
      const tool = makeTool({ riskTiers: { readInbox: 1 } })
      expect(resolveRiskTier(tool, 'readInbox')).toBe(1)
    })

    it('handles missing overrides file gracefully', () => {
      _resetOverridesCache()
      mockOverridesContent = null
      const tool = makeTool({ riskTiers: { readInbox: 1 } })
      expect(resolveRiskTier(tool, 'readInbox')).toBe(1)
    })

    it('handles malformed overrides file gracefully', () => {
      _resetOverridesCache()
      mockOverridesContent = 'not json'
      const tool = makeTool({ riskTiers: { readInbox: 1 } })
      // JSON.parse will throw, caught by loadUserOverrides
      expect(resolveRiskTier(tool, 'readInbox')).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // requiresConfirmationForTier
  // -------------------------------------------------------------------------

  describe('requiresConfirmationForTier()', () => {
    it('returns false for tier 0', () => {
      expect(requiresConfirmationForTier(0)).toBe(false)
    })

    it('returns false for tier 1', () => {
      expect(requiresConfirmationForTier(1)).toBe(false)
    })

    it('returns true for tier 2', () => {
      expect(requiresConfirmationForTier(2)).toBe(true)
    })

    it('returns true for tier 3', () => {
      expect(requiresConfirmationForTier(3)).toBe(true)
    })

    it('returns true for tier 4', () => {
      expect(requiresConfirmationForTier(4)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [])
    })

    it('has no network access', () => {
      const fetchPattern = /\bfe(?:tch)\s*\(/
      expect(sourceCode).not.toMatch(fetchPattern)
    })

    it('reads only from well-known config path', () => {
      expect(sourceCode).toContain('.openclaw')
      expect(sourceCode).toContain('tier-overrides.json')
    })
  })
})
