import { execFileSync } from 'node:child_process'
import { exit } from 'node:process'

let failed = false

/** Paths that are dev/build-tool transitive deps — not in production bundles.
 *  We log them as warnings but don't fail the build. */
const DEV_TOOL_PATH_PREFIXES = [
  'apps__mobile>expo>',           // Expo CLI tooling
  'apps__desktop>electron-builder>', // Build tooling
  '.>eslint',                     // Linter
  '.>@typescript-eslint/',        // Linter plugins
  'apps__mobile>babel-plugin-',   // Babel build tooling
  '.>vitest>',                    // Test runner
  'apps__mobile>jest-expo>',      // Expo test tooling
]

const isDevToolPath = (p: string): boolean =>
  DEV_TOOL_PATH_PREFIXES.some((prefix) => p.startsWith(prefix))

// 1. pnpm audit for high/critical vulnerabilities (gateway excluded per CLAUDE.md)
console.log('=== pnpm audit ===')
try {
  execFileSync('pnpm', ['audit', '--audit-level=high', '--json'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  console.log('No high/critical vulnerabilities found.')
} catch (err: unknown) {
  const error = err as { status?: number; stdout?: string; stderr?: string }
  if (error.status && error.status > 0 && error.stdout) {
    const audit = JSON.parse(error.stdout) as {
      advisories?: Record<string, {
        severity: string
        module_name: string
        title: string
        findings: Array<{ paths: string[] }>
      }>
    }
    const advisories = audit.advisories ?? {}
    let prodCount = 0
    let devToolCount = 0
    for (const [, advisory] of Object.entries(advisories)) {
      if (advisory.severity !== 'high' && advisory.severity !== 'critical') continue
      const nonGatewayPaths = advisory.findings.flatMap((f) =>
        f.paths.filter((p) => !p.startsWith('packages__gateway')),
      )
      if (nonGatewayPaths.length === 0) continue
      const prodPaths = nonGatewayPaths.filter((p) => !isDevToolPath(p))
      const devPaths = nonGatewayPaths.filter((p) => isDevToolPath(p))
      if (prodPaths.length > 0) {
        console.error(`  ${advisory.severity}: ${advisory.module_name} — ${advisory.title}`)
        for (const p of prodPaths) console.error(`    Path: ${p}`)
        prodCount++
      }
      if (devPaths.length > 0) {
        console.warn(`  [dev-tool] ${advisory.severity}: ${advisory.module_name} — ${advisory.title}`)
        for (const p of devPaths) console.warn(`    Path: ${p}`)
        devToolCount++
      }
    }
    if (prodCount > 0) {
      console.error(`pnpm audit: ${String(prodCount)} production vulnerabilities found`)
      failed = true
    }
    if (devToolCount > 0) {
      console.warn(`pnpm audit: ${String(devToolCount)} dev-tool-only vulnerabilities (not blocking)`)
    }
    if (prodCount === 0 && devToolCount === 0) {
      console.log('pnpm audit: only gateway vulnerabilities found (excluded per CLAUDE.md)')
    }
  }
}

// 2. Scan for dangerous patterns in source code
console.log('\n=== Dangerous Pattern Scan ===')
const dangerousPatterns = ['eval\\(', 'new Function\\(', '\\.exec\\(']

for (const pattern of dangerousPatterns) {
  try {
    const result = execFileSync(
      'grep',
      [
        '-rn',
        '--include=*.ts',
        '--include=*.tsx',
        '--include=*.js',
        '--exclude-dir=node_modules',
        '--exclude-dir=dist',
        '--exclude-dir=out',
        '--exclude-dir=gateway',
        '--exclude-dir=release',
        pattern,
        'apps/',
        'packages/',
        'scripts/',
      ],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    if (result.trim()) {
      // Filter out the audit-deps.ts file itself
      const lines = result
        .trim()
        .split('\n')
        .filter((line: string) => !line.includes('audit-deps.ts') && !line.includes('risk-policy-gate'))
      if (lines.length > 0) {
        console.error(`Found dangerous pattern "${pattern}":`)
        for (const line of lines) {
          console.error(`  ${line}`)
        }
        failed = true
      }
    }
  } catch {
    // grep returns exit 1 when no matches found — that's OK
  }
}

// 3. Scan for hardcoded secrets
console.log('\n=== Secret Scan ===')
const secretPatterns = ['sk-[a-zA-Z0-9]', 'PRIVATE_KEY', 'password=']

for (const pattern of secretPatterns) {
  try {
    const result = execFileSync(
      'grep',
      [
        '-rn',
        '--include=*.ts',
        '--include=*.tsx',
        '--include=*.js',
        '--exclude-dir=node_modules',
        '--exclude-dir=dist',
        '--exclude-dir=out',
        '--exclude-dir=gateway',
        '--exclude-dir=release',
        pattern,
        'apps/',
        'packages/',
        'scripts/',
      ],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    if (result.trim()) {
      // Filter out the audit-deps.ts file itself
      const lines = result
        .trim()
        .split('\n')
        .filter((line: string) => !line.includes('audit-deps.ts') && !line.includes('risk-policy-gate'))
      if (lines.length > 0) {
        console.error(`Found potential secret pattern "${pattern}":`)
        for (const line of lines) {
          console.error(`  ${line}`)
        }
        failed = true
      }
    }
  } catch {
    // grep returns exit 1 when no matches found — that's OK
  }
}

if (failed) {
  console.error('\nAudit FAILED — fix issues above before committing.')
  exit(1)
} else {
  console.log('\nAll checks passed.')
}
