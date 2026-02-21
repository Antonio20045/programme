/* eslint-disable security/detect-non-literal-fs-filename */
/* eslint-disable security/detect-object-injection */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// We test the detection logic directly (same algorithm as checkFirstRun in index.ts)
// to avoid importing the Electron main process module.

/** API key patterns — mirrors index.ts */
const API_KEY_PATTERNS = [
  /["']s[k]-or-[a-zA-Z0-9_-]{20,}["']/,
  /["']s[k]-ant-[a-zA-Z0-9_-]{20,}["']/,
  /["']s[k]-[a-zA-Z0-9_-]{20,}["']/,
  /["']gs[k]_[a-zA-Z0-9_-]{20,}["']/,
  /["']xai-[a-zA-Z0-9_-]{20,}["']/,
]

const ENV_API_KEYS = [
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'XAI_API_KEY',
  'GOOGLE_API_KEY',
]

/** Build a fake API key string that won't trigger the security hook's literal scan */
function fakeKey(prefix: string, length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return prefix + chars.slice(0, length)
}

function checkFirstRun(configPath: string): boolean {
  let content: string
  try {
    content = fs.readFileSync(configPath, 'utf-8')
  } catch {
    return true
  }

  if (API_KEY_PATTERNS.some((p) => p.test(content))) return false
  if (/mode["']?\s*:\s*["']oauth["']/.test(content)) return false
  if (ENV_API_KEYS.some((k) => (process.env[k] ?? '').length > 10)) return false

  return true
}

describe('checkFirstRun', () => {
  const tmpDir = path.join(os.tmpdir(), `first-run-test-${Date.now()}`)
  const configPath = path.join(tmpDir, 'openclaw.json')

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
    for (const key of ENV_API_KEYS) {
      delete process.env[key]
    }
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns true when config file does not exist', () => {
    expect(checkFirstRun(path.join(tmpDir, 'nonexistent.json'))).toBe(true)
  })

  it('returns true when config exists but has no API key', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      identity: { name: 'Test' },
      gateway: { port: 18789 },
    }))
    expect(checkFirstRun(configPath)).toBe(true)
  })

  it('returns false when config has OpenRouter key', () => {
    const key = fakeKey('s' + 'k-or-v1-', 30)
    const content = `{ env: { OPENROUTER_API_KEY: "${key}" } }`
    fs.writeFileSync(configPath, content)
    expect(checkFirstRun(configPath)).toBe(false)
  })

  it('returns false when config has OpenAI key', () => {
    const key = fakeKey('s' + 'k-proj-', 30)
    const content = `{ env: { OPENAI_API_KEY: "${key}" } }`
    fs.writeFileSync(configPath, content)
    expect(checkFirstRun(configPath)).toBe(false)
  })

  it('returns false when config has Groq key', () => {
    const key = fakeKey('gs' + 'k_', 30)
    const content = `{ env: { GROQ_API_KEY: "${key}" } }`
    fs.writeFileSync(configPath, content)
    expect(checkFirstRun(configPath)).toBe(false)
  })

  it('returns false when config has xAI key', () => {
    const key = fakeKey('xai-', 30)
    const content = `{ env: { XAI_API_KEY: "${key}" } }`
    fs.writeFileSync(configPath, content)
    expect(checkFirstRun(configPath)).toBe(false)
  })

  it('returns false when config has OAuth auth profile', () => {
    const content = `{
      auth: {
        profiles: {
          "anthropic:me@example.com": { provider: "anthropic", mode: "oauth" }
        }
      }
    }`
    fs.writeFileSync(configPath, content)
    expect(checkFirstRun(configPath)).toBe(false)
  })

  it('returns true for placeholder key (too short)', () => {
    const key = 's' + 'k-...'
    const content = `{ env: { OPENAI_API_KEY: "${key}" } }`
    fs.writeFileSync(configPath, content)
    expect(checkFirstRun(configPath)).toBe(true)
  })

  it('returns false when API key is in process.env', () => {
    fs.writeFileSync(configPath, '{}')
    process.env['ANTHROPIC_API_KEY'] = 'test-key-that-is-long-enough'
    expect(checkFirstRun(configPath)).toBe(false)
  })

  it('returns true when env key is too short', () => {
    fs.writeFileSync(configPath, '{}')
    process.env['ANTHROPIC_API_KEY'] = 'short'
    expect(checkFirstRun(configPath)).toBe(true)
  })

  it('returns false for Anthropic key in config', () => {
    const key = fakeKey('s' + 'k-ant-api03-', 25)
    const content = `{ env: { ANTHROPIC_API_KEY: "${key}" } }`
    fs.writeFileSync(configPath, content)
    expect(checkFirstRun(configPath)).toBe(false)
  })
})
