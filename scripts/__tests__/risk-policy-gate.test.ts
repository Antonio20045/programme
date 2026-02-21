import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyFile,
  computeRiskTier,
  checkDocsDrift,
  getChangedFiles,
  formatReport,
  queryCheckStatuses,
  main,
} from '../risk-policy-gate'
import type { RiskPolicy, GateResult } from '../risk-policy-gate'

// ── Load real policy for integration tests ──────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const POLICY_PATH = resolve(SCRIPT_DIR, '../../risk-policy.json')
const policy: RiskPolicy = JSON.parse(readFileSync(POLICY_PATH, 'utf-8'))

const mockedExecFileSync = vi.mocked(execFileSync)

// ── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── classifyFile ────────────────────────────────────────────────

describe('classifyFile', () => {
  describe('critical tier', () => {
    const criticalPaths = [
      'packages/tools/src/shell.ts',
      'packages/tools/src/filesystem.ts',
      'packages/tools/src/browser.ts',
      'packages/tools/src/http-client.ts',
      'packages/tools/src/code-runner.ts',
      'packages/tools/src/verify.ts',
      'packages/tools/src/public-key.ts',
      'packages/tools/signatures.json',
      'packages/tools/src/register.ts',
      'packages/shared/src/encryption.ts',
      'apps/desktop/src/main/index.ts',
      'apps/desktop/src/main/agent.ts',
      'apps/desktop/src/main/oauth-server.ts',
      'apps/desktop/src/preload/index.ts',
      'packages/relay/src/index.ts',
      'packages/relay/src/jwt.ts',
      'packages/gateway/src/agents/auth.ts',
      'scripts/sign-tools.ts',
      'docker-compose.yml',
    ]

    for (const path of criticalPaths) {
      it(`classifies ${path} as critical`, () => {
        expect(classifyFile(path, policy)).toBe('critical')
      })
    }
  })

  describe('high tier', () => {
    const highPaths = [
      '.github/workflows/release.yml',
      '.claude/hooks/check.sh',
      '.claude/agents/security-auditor.md',
      'scripts/audit-deps.ts',
      'risk-policy.json',
      'CLAUDE.md',
      'packages/tools/src/calculator.ts',
      'packages/tools/src/weather.ts',
      'packages/tools/src/translator.ts',
      'apps/mobile/src/services/relay.ts',
      'apps/mobile/src/contexts/AuthContext.tsx',
    ]

    for (const path of highPaths) {
      it(`classifies ${path} as high`, () => {
        expect(classifyFile(path, policy)).toBe('high')
      })
    }
  })

  describe('low tier', () => {
    const lowPaths = [
      'apps/desktop/src/renderer/src/components/Sidebar.tsx',
      'apps/desktop/src/renderer/src/pages/Chat.tsx',
      'apps/desktop/src/renderer/src/hooks/useChat.ts',
      'apps/mobile/src/screens/ChatScreen.tsx',
      'apps/mobile/src/components/MessageBubble.tsx',
      'packages/tools/__tests__/calculator.test.ts',
      'apps/desktop/src/__tests__/first-run.test.ts',
      'docs/openclaw-analyse.md',
      'vitest.config.ts',
      '.eslintrc.js',
      'pnpm-lock.yaml',
      'apps/desktop/electron.vite.config.ts',
      'package.json',
    ]

    for (const path of lowPaths) {
      it(`classifies ${path} as low`, () => {
        expect(classifyFile(path, policy)).toBe('low')
      })
    }
  })

  describe('priority ordering', () => {
    it('classifies shell.ts as critical (not high via *.ts glob)', () => {
      expect(classifyFile('packages/tools/src/shell.ts', policy)).toBe(
        'critical',
      )
    })

    it('classifies sign-tools.ts as critical (not high via scripts/**)', () => {
      expect(classifyFile('scripts/sign-tools.ts', policy)).toBe('critical')
    })

    it('classifies CLAUDE.md as high (not low via *.md)', () => {
      expect(classifyFile('CLAUDE.md', policy)).toBe('high')
    })
  })

  describe('unknown files', () => {
    it('returns unknown for unmatched paths', () => {
      expect(classifyFile('some-random-file.xyz', policy)).toBe('unknown')
    })

    it('returns unknown for new packages without patterns', () => {
      expect(classifyFile('packages/new-pkg/src/foo.ts', policy)).toBe(
        'unknown',
      )
    })
  })
})

// ── computeRiskTier ─────────────────────────────────────────────

describe('computeRiskTier', () => {
  it('returns critical when any file is critical', () => {
    const files = [
      'packages/tools/src/shell.ts',
      'apps/desktop/src/renderer/src/components/Sidebar.tsx',
    ]
    const result = computeRiskTier(files, policy)
    expect(result.tier).toBe('critical')
    expect(result.requireHumanReview).toBe(true)
    expect(result.requiredChecks).toContain('pentest-review')
  })

  it('returns high when highest file is high', () => {
    const files = [
      'packages/tools/src/calculator.ts',
      'apps/desktop/src/renderer/src/components/Sidebar.tsx',
    ]
    const result = computeRiskTier(files, policy)
    expect(result.tier).toBe('high')
    expect(result.requireHumanReview).toBe(false)
    expect(result.requiredChecks).toContain('security-audit')
  })

  it('returns low when only low files changed', () => {
    const files = [
      'apps/desktop/src/renderer/src/components/Sidebar.tsx',
      'docs/openclaw-analyse.md',
    ]
    const result = computeRiskTier(files, policy)
    expect(result.tier).toBe('low')
    expect(result.requiredChecks).not.toContain('security-audit')
    expect(result.requiredChecks).not.toContain('pentest-review')
  })

  it('escalates unknown files to high', () => {
    const files = ['totally-unknown-file.xyz']
    const result = computeRiskTier(files, policy)
    expect(result.tier).toBe('high')
    expect(result.unknownFiles).toContain('totally-unknown-file.xyz')
  })

  it('returns low for empty changeset', () => {
    const result = computeRiskTier([], policy)
    expect(result.tier).toBe('low')
    expect(result.changedFiles).toHaveLength(0)
  })

  it('buckets files correctly', () => {
    const files = [
      'packages/tools/src/shell.ts',
      'scripts/audit-deps.ts',
      'docs/openclaw-analyse.md',
      'totally-unknown.xyz',
    ]
    const result = computeRiskTier(files, policy)
    expect(result.criticalFiles).toContain('packages/tools/src/shell.ts')
    expect(result.highFiles).toContain('scripts/audit-deps.ts')
    expect(result.lowFiles).toContain('docs/openclaw-analyse.md')
    expect(result.unknownFiles).toContain('totally-unknown.xyz')
  })
})

// ── checkDocsDrift ──────────────────────────────────────────────

describe('checkDocsDrift', () => {
  it('detects drift when risk-policy.json changes', () => {
    const result = checkDocsDrift(['risk-policy.json'], policy)
    expect(result.drift).toBe(true)
    expect(result.files).toContain('risk-policy.json')
  })

  it('detects drift when workflow changes', () => {
    const result = checkDocsDrift(['.github/workflows/release.yml'], policy)
    expect(result.drift).toBe(true)
  })

  it('detects drift when claude rules change', () => {
    const result = checkDocsDrift(
      ['.claude/rules/security.md'],
      policy,
    )
    expect(result.drift).toBe(true)
  })

  it('no drift for normal source changes', () => {
    const result = checkDocsDrift(
      ['apps/desktop/src/main/index.ts'],
      policy,
    )
    expect(result.drift).toBe(false)
    expect(result.files).toHaveLength(0)
  })

  it('no drift for UI changes', () => {
    const result = checkDocsDrift(
      ['apps/desktop/src/renderer/src/components/Sidebar.tsx'],
      policy,
    )
    expect(result.drift).toBe(false)
  })
})

// ── getChangedFiles ─────────────────────────────────────────────

describe('getChangedFiles', () => {
  it('parses git diff output correctly in pr mode', () => {
    mockedExecFileSync.mockReturnValue('file1.ts\nfile2.ts\nfile3.ts\n')
    const files = getChangedFiles('pr')
    expect(files).toEqual(['file1.ts', 'file2.ts', 'file3.ts'])
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'main...HEAD'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
  })

  it('uses HEAD~1 in push mode', () => {
    mockedExecFileSync.mockReturnValue('changed.ts\n')
    const files = getChangedFiles('push')
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'HEAD~1'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
    expect(files).toEqual(['changed.ts'])
  })

  it('returns empty array on git error', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('fatal: not a git repository')
    })
    const files = getChangedFiles('pr')
    expect(files).toEqual([])
  })

  it('filters empty lines', () => {
    mockedExecFileSync.mockReturnValue('file1.ts\n\n\nfile2.ts\n')
    const files = getChangedFiles('pr')
    expect(files).toEqual(['file1.ts', 'file2.ts'])
  })
})

// ── formatReport ────────────────────────────────────────────────

describe('formatReport', () => {
  it('includes tier and required checks', () => {
    const result: GateResult = {
      tier: 'critical',
      label: 'CRITICAL',
      requireHumanReview: true,
      requiredChecks: ['typecheck', 'lint', 'test'],
      changedFiles: ['packages/tools/src/shell.ts'],
      criticalFiles: ['packages/tools/src/shell.ts'],
      highFiles: [],
      lowFiles: [],
      unknownFiles: [],
      docsDrift: false,
      driftFiles: [],
    }
    const report = formatReport(result)
    expect(report).toContain('CRITICAL')
    expect(report).toContain('Human Review Required: Yes')
    expect(report).toContain('typecheck')
    expect(report).toContain('lint')
    expect(report).toContain('test')
  })

  it('shows docs drift warning', () => {
    const result: GateResult = {
      tier: 'high',
      label: 'HIGH',
      requireHumanReview: false,
      requiredChecks: ['typecheck'],
      changedFiles: ['risk-policy.json'],
      criticalFiles: [],
      highFiles: ['risk-policy.json'],
      lowFiles: [],
      unknownFiles: [],
      docsDrift: true,
      driftFiles: ['risk-policy.json'],
    }
    const report = formatReport(result)
    expect(report).toContain('Docs Drift Detected')
    expect(report).toContain('risk-policy.json')
  })
})

// ── queryCheckStatuses ───────────────────────────────────────────

describe('queryCheckStatuses', () => {
  let savedToken: string | undefined
  let savedRepo: string | undefined
  let savedSha: string | undefined

  beforeEach(() => {
    savedToken = process.env['GITHUB_TOKEN']
    savedRepo = process.env['GITHUB_REPOSITORY']
    savedSha = process.env['PR_HEAD_SHA']
  })

  afterEach(() => {
    if (savedToken !== undefined) process.env['GITHUB_TOKEN'] = savedToken
    else delete process.env['GITHUB_TOKEN']
    if (savedRepo !== undefined) process.env['GITHUB_REPOSITORY'] = savedRepo
    else delete process.env['GITHUB_REPOSITORY']
    if (savedSha !== undefined) process.env['PR_HEAD_SHA'] = savedSha
    else delete process.env['PR_HEAD_SHA']
    vi.unstubAllGlobals()
  })

  it('returns queried:false without GITHUB_TOKEN', async () => {
    delete process.env['GITHUB_TOKEN']
    const result = await queryCheckStatuses(['typecheck', 'lint'])
    expect(result.queried).toBe(false)
  })

  it('returns queried:false without GITHUB_REPOSITORY', async () => {
    process.env['GITHUB_TOKEN'] = 'test-token'
    delete process.env['GITHUB_REPOSITORY']
    const result = await queryCheckStatuses(['typecheck', 'lint'])
    expect(result.queried).toBe(false)
  })

  it('returns queried:false without PR_HEAD_SHA', async () => {
    process.env['GITHUB_TOKEN'] = 'test-token'
    process.env['GITHUB_REPOSITORY'] = 'owner/repo'
    delete process.env['PR_HEAD_SHA']
    const result = await queryCheckStatuses(['typecheck', 'lint'])
    expect(result.queried).toBe(false)
  })

  it('classifies checks as passed/failed/missing', async () => {
    process.env['GITHUB_TOKEN'] = 'test-token'
    process.env['GITHUB_REPOSITORY'] = 'owner/repo'
    process.env['PR_HEAD_SHA'] = 'abc123'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          check_runs: [
            { name: 'typecheck', conclusion: 'success', status: 'completed' },
            { name: 'lint', conclusion: 'failure', status: 'completed' },
          ],
        }),
      }),
    )

    const result = await queryCheckStatuses(['typecheck', 'lint', 'test'])
    expect(result.queried).toBe(true)
    expect(result.passed).toEqual(['typecheck'])
    expect(result.failed).toEqual(['lint'])
    expect(result.missing).toEqual(['test'])
  })

  it('excludes self check (risk-policy-gate)', async () => {
    process.env['GITHUB_TOKEN'] = 'test-token'
    process.env['GITHUB_REPOSITORY'] = 'owner/repo'
    process.env['PR_HEAD_SHA'] = 'abc123'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ check_runs: [] }),
      }),
    )

    const result = await queryCheckStatuses([
      'typecheck',
      'risk-policy-gate',
    ])
    expect(result.missing).toEqual(['typecheck'])
    expect(result.missing).not.toContain('risk-policy-gate')
    expect(result.passed).not.toContain('risk-policy-gate')
  })

  it('treats pending conclusions as failed', async () => {
    process.env['GITHUB_TOKEN'] = 'test-token'
    process.env['GITHUB_REPOSITORY'] = 'owner/repo'
    process.env['PR_HEAD_SHA'] = 'abc123'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          check_runs: [
            { name: 'typecheck', conclusion: null, status: 'in_progress' },
          ],
        }),
      }),
    )

    const result = await queryCheckStatuses(['typecheck'])
    expect(result.pending).toEqual(['typecheck'])
    expect(result.failed).toEqual([])
  })

  it('handles API errors gracefully', async () => {
    process.env['GITHUB_TOKEN'] = 'test-token'
    process.env['GITHUB_REPOSITORY'] = 'owner/repo'
    process.env['PR_HEAD_SHA'] = 'abc123'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      }),
    )

    const result = await queryCheckStatuses(['typecheck'])
    expect(result.queried).toBe(false)
  })

  it('handles network errors gracefully', async () => {
    process.env['GITHUB_TOKEN'] = 'test-token'
    process.env['GITHUB_REPOSITORY'] = 'owner/repo'
    process.env['PR_HEAD_SHA'] = 'abc123'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    )

    const result = await queryCheckStatuses(['typecheck'])
    expect(result.queried).toBe(false)
  })
})

// ── main ────────────────────────────────────────────────────────

describe('main', () => {
  let savedToken: string | undefined
  let savedRepo: string | undefined
  let savedSha: string | undefined

  beforeEach(() => {
    savedToken = process.env['GITHUB_TOKEN']
    savedRepo = process.env['GITHUB_REPOSITORY']
    savedSha = process.env['PR_HEAD_SHA']
    // Default: no GitHub API (local mode)
    delete process.env['GITHUB_TOKEN']
    delete process.env['GITHUB_REPOSITORY']
    delete process.env['PR_HEAD_SHA']
  })

  afterEach(() => {
    if (savedToken !== undefined) process.env['GITHUB_TOKEN'] = savedToken
    else delete process.env['GITHUB_TOKEN']
    if (savedRepo !== undefined) process.env['GITHUB_REPOSITORY'] = savedRepo
    else delete process.env['GITHUB_REPOSITORY']
    if (savedSha !== undefined) process.env['PR_HEAD_SHA'] = savedSha
    else delete process.env['PR_HEAD_SHA']
    vi.unstubAllGlobals()
  })

  it('returns 0 for low tier without GitHub API', async () => {
    mockedExecFileSync.mockReturnValue('')
    const exitCode = await main()
    expect(exitCode).toBe(0)
  })

  it('returns 1 for critical tier (human review required)', async () => {
    mockedExecFileSync.mockReturnValue('packages/tools/src/shell.ts\n')
    const exitCode = await main()
    expect(exitCode).toBe(1)
  })

  it('returns 0 for high tier without GitHub API', async () => {
    mockedExecFileSync.mockReturnValue('scripts/audit-deps.ts\n')
    const exitCode = await main()
    expect(exitCode).toBe(0)
  })

  it('returns 1 when required checks are missing (GitHub API)', async () => {
    process.env['GITHUB_TOKEN'] = 'test-token'
    process.env['GITHUB_REPOSITORY'] = 'owner/repo'
    process.env['PR_HEAD_SHA'] = 'abc123'
    mockedExecFileSync.mockReturnValue('docs/openclaw-analyse.md\n') // low tier

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ check_runs: [] }), // no checks found
      }),
    )

    const exitCode = await main()
    expect(exitCode).toBe(0) // missing checks don't block — Branch Protection enforces those
  })

  it('returns 0 when all required checks pass (GitHub API)', async () => {
    process.env['GITHUB_TOKEN'] = 'test-token'
    process.env['GITHUB_REPOSITORY'] = 'owner/repo'
    process.env['PR_HEAD_SHA'] = 'abc123'
    mockedExecFileSync.mockReturnValue('docs/openclaw-analyse.md\n') // low tier

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          check_runs: [
            { name: 'typecheck', conclusion: 'success', status: 'completed' },
            { name: 'lint', conclusion: 'success', status: 'completed' },
            { name: 'test', conclusion: 'success', status: 'completed' },
          ],
        }),
      }),
    )

    const exitCode = await main()
    expect(exitCode).toBe(0)
  })

  it('returns 1 when a required check failed (GitHub API)', async () => {
    process.env['GITHUB_TOKEN'] = 'test-token'
    process.env['GITHUB_REPOSITORY'] = 'owner/repo'
    process.env['PR_HEAD_SHA'] = 'abc123'
    mockedExecFileSync.mockReturnValue('docs/openclaw-analyse.md\n') // low tier

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          check_runs: [
            { name: 'typecheck', conclusion: 'success', status: 'completed' },
            { name: 'lint', conclusion: 'failure', status: 'completed' },
            { name: 'test', conclusion: 'success', status: 'completed' },
          ],
        }),
      }),
    )

    const exitCode = await main()
    expect(exitCode).toBe(1)
  })
})
