import { execFileSync } from 'node:child_process'
import { exit } from 'node:process'

let failed = false

// 1. pnpm audit for high/critical vulnerabilities
console.log('=== pnpm audit ===')
try {
  const auditOutput = execFileSync('pnpm', ['audit', '--audit-level=high'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  console.log(auditOutput)
} catch (err: unknown) {
  const error = err as { status?: number; stdout?: string; stderr?: string }
  if (error.status && error.status > 0) {
    console.error('pnpm audit found vulnerabilities:')
    if (error.stdout) console.error(error.stdout)
    if (error.stderr) console.error(error.stderr)
    failed = true
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
        .filter((line: string) => !line.includes('audit-deps.ts'))
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
        .filter((line: string) => !line.includes('audit-deps.ts'))
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
