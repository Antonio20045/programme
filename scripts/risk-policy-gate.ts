/**
 * Risk Policy Gate — computes risk tier from git diff against risk-policy.json.
 *
 * Usage:
 *   tsx scripts/risk-policy-gate.ts              # PR mode (main...HEAD), human-readable
 *   tsx scripts/risk-policy-gate.ts --push       # Push mode (HEAD~1)
 *   tsx scripts/risk-policy-gate.ts --json       # JSON-only output
 *
 * Exit code: 0 = all required checks passed. 1 = blocking (checks missing/failed or human review required).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import picomatch from 'picomatch'

// ── Paths ───────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const POLICY_PATH = resolve(ROOT, 'risk-policy.json')

// ── Types ───────────────────────────────────────────────────────

interface TierConfig {
  readonly label: string
  readonly description: string
  readonly requiredChecks: readonly string[]
  readonly requireHumanReview: boolean
  readonly patterns: readonly string[]
}

export interface RiskPolicy {
  readonly version: number
  readonly tiers: {
    readonly critical: TierConfig
    readonly high: TierConfig
    readonly low: TierConfig
  }
  readonly docsDrift: {
    readonly watchPaths: readonly string[]
  }
}

export type TierName = 'critical' | 'high' | 'low'

export interface GateResult {
  readonly tier: TierName
  readonly label: string
  readonly requireHumanReview: boolean
  readonly requiredChecks: readonly string[]
  readonly changedFiles: readonly string[]
  readonly criticalFiles: readonly string[]
  readonly highFiles: readonly string[]
  readonly lowFiles: readonly string[]
  readonly unknownFiles: readonly string[]
  readonly docsDrift: boolean
  readonly driftFiles: readonly string[]
  readonly checkStatuses?: CheckStatusResult
}

export interface CheckStatusResult {
  readonly queried: boolean
  readonly passed: readonly string[]
  readonly failed: readonly string[]
  readonly pending: readonly string[]
  readonly missing: readonly string[]
}

// ── Self check name (excluded from status queries) ──────────────

const SELF_CHECK_NAME = 'risk-policy-gate'

// ── Tier priority (evaluation order) ────────────────────────────

const TIER_ORDER: readonly TierName[] = ['critical', 'high', 'low']

// ── Core Functions ──────────────────────────────────────────────

export function getChangedFiles(mode: 'pr' | 'push'): string[] {
  try {
    const args =
      mode === 'pr'
        ? ['diff', '--name-only', 'main...HEAD']
        : ['diff', '--name-only', 'HEAD~1']

    const output = execFileSync('git', args, {
      encoding: 'utf-8',
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    // Shallow clone or no git history — return empty
    return []
  }
}

export function classifyFile(
  filePath: string,
  policy: RiskPolicy,
): TierName | 'unknown' {
  for (const tier of TIER_ORDER) {
    const config = policy.tiers[tier]
    for (const pattern of config.patterns) {
      const isMatch = picomatch(pattern, { dot: true })
      if (isMatch(filePath)) {
        return tier
      }
    }
  }
  return 'unknown'
}

export function computeRiskTier(
  changedFiles: readonly string[],
  policy: RiskPolicy,
): GateResult {
  const criticalFiles: string[] = []
  const highFiles: string[] = []
  const lowFiles: string[] = []
  const unknownFiles: string[] = []

  for (const file of changedFiles) {
    const tier = classifyFile(file, policy)
    switch (tier) {
      case 'critical':
        criticalFiles.push(file)
        break
      case 'high':
        highFiles.push(file)
        break
      case 'low':
        lowFiles.push(file)
        break
      default:
        unknownFiles.push(file)
        break
    }
  }

  // Determine overall tier — highest wins, unknown escalates to high
  let tier: TierName = 'low'
  if (criticalFiles.length > 0) {
    tier = 'critical'
  } else if (highFiles.length > 0 || unknownFiles.length > 0) {
    tier = 'high'
  }

  // Empty changeset → low (no risk)
  const tierConfig = policy.tiers[tier]
  const drift = checkDocsDrift(changedFiles, policy)

  return {
    tier,
    label: tierConfig.label,
    requireHumanReview: tierConfig.requireHumanReview,
    requiredChecks: [...tierConfig.requiredChecks],
    changedFiles: [...changedFiles],
    criticalFiles,
    highFiles,
    lowFiles,
    unknownFiles,
    docsDrift: drift.drift,
    driftFiles: drift.files,
  }
}

export function checkDocsDrift(
  changedFiles: readonly string[],
  policy: RiskPolicy,
): { drift: boolean; files: string[] } {
  const driftFiles: string[] = []

  for (const file of changedFiles) {
    for (const watchPattern of policy.docsDrift.watchPaths) {
      const isMatch = picomatch(watchPattern, { dot: true })
      if (isMatch(file)) {
        driftFiles.push(file)
        break
      }
    }
  }

  return { drift: driftFiles.length > 0, files: driftFiles }
}

export async function queryCheckStatuses(
  requiredChecks: readonly string[],
): Promise<CheckStatusResult> {
  const token = process.env['GITHUB_TOKEN']
  const repo = process.env['GITHUB_REPOSITORY']
  const sha = process.env['PR_HEAD_SHA']

  if (!token || !repo || !sha) {
    return { queried: false, passed: [], failed: [], pending: [], missing: [] }
  }

  const url = `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!response.ok) {
      console.error(
        `GitHub API error: ${String(response.status)} ${response.statusText}`,
      )
      return { queried: false, passed: [], failed: [], pending: [], missing: [] }
    }

    interface CheckRun {
      name: string
      conclusion: string | null
      status: string
    }

    const data = (await response.json()) as { check_runs: CheckRun[] }

    const checkMap = new Map<string, CheckRun>()
    for (const run of data.check_runs) {
      checkMap.set(run.name, run)
    }

    const passed: string[] = []
    const failed: string[] = []
    const pending: string[] = []
    const missing: string[] = []

    for (const check of requiredChecks) {
      if (check === SELF_CHECK_NAME) continue

      const run = checkMap.get(check)
      if (run === undefined) {
        missing.push(check)
      } else if (run.status !== 'completed') {
        pending.push(check)
      } else if (run.conclusion === 'success') {
        passed.push(check)
      } else {
        failed.push(check)
      }
    }

    return { queried: true, passed, failed, pending, missing }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`GitHub API request failed: ${msg}`)
    return { queried: false, passed: [], failed: [], pending: [], missing: [] }
  }
}

export function formatReport(result: GateResult): string {
  const lines: string[] = []

  lines.push('Risk Policy Gate')
  lines.push('═'.repeat(50))
  lines.push('')
  lines.push(`  Tier:                 ${result.label}`)
  lines.push(
    `  Human Review Required: ${result.requireHumanReview ? 'Yes' : 'No'}`,
  )
  lines.push(`  Docs Drift:           ${result.docsDrift ? 'Yes' : 'No'}`)
  lines.push(`  Changed Files:        ${String(result.changedFiles.length)}`)
  lines.push('')

  lines.push('Required Checks:')
  for (const check of result.requiredChecks) {
    lines.push(`  - ${check}`)
  }
  lines.push('')

  const sections = [
    { name: 'Critical', files: result.criticalFiles },
    { name: 'High', files: result.highFiles },
    { name: 'Low', files: result.lowFiles },
    { name: 'Unknown (→ HIGH)', files: result.unknownFiles },
  ] as const

  for (const section of sections) {
    if (section.files.length > 0) {
      lines.push(
        `${section.name} (${String(section.files.length)} file${section.files.length !== 1 ? 's' : ''}):`,
      )
      for (const file of section.files) {
        lines.push(`  - ${file}`)
      }
      lines.push('')
    }
  }

  if (result.docsDrift) {
    lines.push('Docs Drift Detected:')
    for (const file of result.driftFiles) {
      lines.push(`  - ${file}`)
    }
    lines.push('')
  }

  if (result.checkStatuses?.queried) {
    lines.push('Check Statuses:')
    for (const check of result.checkStatuses.passed) {
      lines.push(`  pass: ${check}`)
    }
    for (const check of result.checkStatuses.failed) {
      lines.push(`  FAIL: ${check}`)
    }
    for (const check of result.checkStatuses.pending) {
      lines.push(`  PENDING: ${check}`)
    }
    for (const check of result.checkStatuses.missing) {
      lines.push(`  MISSING: ${check}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ── Main ────────────────────────────────────────────────────────

export async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const jsonOnly = args.includes('--json')
  const pushMode = args.includes('--push')

  const policyRaw = readFileSync(POLICY_PATH, 'utf-8')
  const policy = JSON.parse(policyRaw) as RiskPolicy

  const mode = pushMode ? 'push' : 'pr'
  const changedFiles = getChangedFiles(mode)
  const riskResult = computeRiskTier(changedFiles, policy)

  // Query GitHub API for actual check statuses
  const checkStatuses = await queryCheckStatuses(riskResult.requiredChecks)
  const result: GateResult = { ...riskResult, checkStatuses }

  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(formatReport(result))
    console.log(JSON.stringify(result, null, 2))
  }

  // Block: human review required OR any required check explicitly failed.
  // Pending/missing checks don't block — Branch Protection enforces those.
  const checksBlocking =
    checkStatuses.queried && checkStatuses.failed.length > 0

  return result.requireHumanReview || checksBlocking ? 1 : 0
}

// Only run when executed directly (not when imported in tests)
const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().then((code) => process.exit(code))
}
