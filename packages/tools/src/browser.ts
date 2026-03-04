/**
 * Browser tool — navigate pages, take screenshots, fill forms, click elements,
 * read accessibility tree, manage cookies, and wait for conditions.
 * Uses Playwright headless Chromium loaded via dynamic import.
 *
 * URL policy: Only http:// and https:// URLs are permitted.
 * Blocked: file://, javascript:, data:, and all other schemes.
 *
 * Rate limit: max 30 actions per minute.
 * Browser instance is reused across invocations.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Minimal Playwright interfaces (avoids compile-time dependency)
// ---------------------------------------------------------------------------

interface PlaywrightLocator {
  fill(value: string, options?: { timeout?: number }): Promise<void>
}

interface CookieData {
  readonly name: string
  readonly value: string
  readonly domain?: string
  readonly path?: string
}

interface PlaywrightBrowserContext {
  cookies(urls?: string | string[]): Promise<CookieData[]>
  addCookies(cookies: CookieData[]): Promise<void>
  clearCookies(): Promise<void>
  pages(): PlaywrightPage[]
  newPage(): Promise<PlaywrightPage>
  close(): Promise<void>
  isConnected?(): boolean
}

interface PlaywrightPage {
  goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<unknown>
  screenshot(options?: { fullPage?: boolean; type?: string }): Promise<Buffer>
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>
  click(selector: string, options?: { timeout?: number }): Promise<void>
  title(): Promise<string>
  url(): string
  close(): Promise<void>
  isClosed(): boolean
  accessibility: { snapshot(): Promise<unknown> }
  selectOption(selector: string, values: string | string[]): Promise<string[]>
  type(selector: string, text: string, opts?: { timeout?: number }): Promise<void>
  waitForSelector(selector: string, opts?: { timeout?: number; state?: string }): Promise<unknown>
  waitForURL(url: string | RegExp, opts?: { timeout?: number }): Promise<void>
  waitForLoadState(state?: string): Promise<void>
  context(): PlaywrightBrowserContext
  getByLabel(text: string): PlaywrightLocator
}

interface PlaywrightChromium {
  launchPersistentContext(
    userDataDir: string,
    options?: { headless?: boolean; args?: string[] },
  ): Promise<PlaywrightBrowserContext>
}

interface PlaywrightModule {
  chromium: PlaywrightChromium
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenPageArgs {
  readonly action: 'openPage'
  readonly url: string
}

interface ScreenshotArgs {
  readonly action: 'screenshot'
}

interface FillFormArgs {
  readonly action: 'fillForm'
  readonly selector: string
  readonly value: string
}

interface ClickElementArgs {
  readonly action: 'clickElement'
  readonly selector: string
}

interface SnapshotArgs {
  readonly action: 'snapshot'
}

interface TypeArgs {
  readonly action: 'type'
  readonly selector: string
  readonly text: string
}

interface SelectArgs {
  readonly action: 'select'
  readonly selector: string
  readonly value: string
}

interface FillArgs {
  readonly action: 'fill'
  readonly fields: Readonly<Record<string, string>>
}

interface CookiesArgs {
  readonly action: 'cookies'
  readonly cookieAction: 'read' | 'set' | 'clear'
  readonly cookieName?: string
  readonly cookieValue?: string
  readonly cookieDomain?: string
}

interface WaitForArgs {
  readonly action: 'waitFor'
  readonly waitType: 'selector' | 'url' | 'load'
  readonly selector?: string
  readonly url?: string
  readonly state?: string
}

interface OpenSessionArgs {
  readonly action: 'openSession'
  readonly domain: string
}

interface CloseSessionArgs {
  readonly action: 'closeSession'
  readonly domain: string
}

interface FillCredentialArgs {
  readonly action: 'fillCredential'
  readonly selector: string
}

interface HealthCheckArgs {
  readonly action: 'healthCheck'
}

type BrowserArgs =
  | OpenPageArgs
  | ScreenshotArgs
  | FillFormArgs
  | ClickElementArgs
  | SnapshotArgs
  | TypeArgs
  | SelectArgs
  | FillArgs
  | CookiesArgs
  | WaitForArgs
  | OpenSessionArgs
  | CloseSessionArgs
  | FillCredentialArgs
  | HealthCheckArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_TIMEOUT_MS = 30_000
const MAX_SNAPSHOT_LENGTH = 50_000
const MAX_ACTIONS_PER_MINUTE = 30
const MAX_FILL_FIELDS = 20
const SESSION_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

const actionTimestamps: number[] = []

function checkRateLimit(): void {
  const now = Date.now()
  while (actionTimestamps.length > 0 && (actionTimestamps[0] as number) < now - 60_000) {
    actionTimestamps.shift()
  }
  if (actionTimestamps.length >= MAX_ACTIONS_PER_MINUTE) {
    throw new Error('Rate limit: max 30 actions per minute')
  }
  actionTimestamps.push(now)
}

/** Test-only: reset rate limiter state. */
function _resetRateLimit(): void {
  actionTimestamps.length = 0
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/**
 * Checks whether a hostname resolves to a private/internal IP range.
 * Blocks: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 * 169.254.0.0/16 (link-local), 0.0.0.0, ::1, fd00::/8, fe80::/10.
 */
function isPrivateHostname(hostname: string): boolean {
  if (hostname === '::1' || hostname === '[::1]') return true

  const parts = hostname.split('.')
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const octets = parts.map(Number)
    const [a, b] = octets as [number, number, number, number]
    if (a === 127) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 0) return true
  }

  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return true
  }

  const lower = hostname.toLowerCase()
  if (lower.startsWith('fd') || lower.startsWith('fe80')) return true

  return false
}

function validateBrowserUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: ${raw}`)
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(
      `Blocked URL scheme "${parsed.protocol}" — only http: and https: are allowed`,
    )
  }

  if (parsed.hostname === '') {
    throw new Error('URL must have a hostname')
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('URLs with embedded credentials are not allowed')
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`Blocked private/internal hostname: ${parsed.hostname}`)
  }

  return parsed
}

// ---------------------------------------------------------------------------
// Domain validation
// ---------------------------------------------------------------------------

function validateDomain(raw: string): string {
  const domain = raw.trim()
  if (domain === '') {
    throw new Error('Domain must not be empty')
  }
  if (domain.includes('/') || domain.includes('\\')) {
    throw new Error('Domain must not contain path separators')
  }
  if (domain.includes('..')) {
    throw new Error('Domain must not contain ".."')
  }
  if (/\s/.test(domain)) {
    throw new Error('Domain must not contain whitespace')
  }
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new Error(`Invalid domain: "${domain}"`)
  }
  return domain
}

function getSessionProfileDir(domain: string): string {
  return join(homedir(), '.openclaw', 'browser-sessions', domain)
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): BrowserArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'openPage') {
    const url = obj['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('openPage requires a non-empty "url" string')
    }
    return { action: 'openPage', url: url.trim() }
  }

  if (action === 'screenshot') {
    return { action: 'screenshot' }
  }

  if (action === 'fillForm') {
    const selector = obj['selector']
    const value = obj['value']
    if (typeof selector !== 'string' || selector.trim() === '') {
      throw new Error('fillForm requires a non-empty "selector" string')
    }
    if (typeof value !== 'string') {
      throw new Error('fillForm requires a "value" string')
    }
    return { action: 'fillForm', selector: selector.trim(), value }
  }

  if (action === 'clickElement') {
    const selector = obj['selector']
    if (typeof selector !== 'string' || selector.trim() === '') {
      throw new Error('clickElement requires a non-empty "selector" string')
    }
    return { action: 'clickElement', selector: selector.trim() }
  }

  if (action === 'snapshot') {
    return { action: 'snapshot' }
  }

  if (action === 'type') {
    const selector = obj['selector']
    const text = obj['text']
    if (typeof selector !== 'string' || selector.trim() === '') {
      throw new Error('type requires a non-empty "selector" string')
    }
    if (typeof text !== 'string') {
      throw new Error('type requires a "text" string')
    }
    return { action: 'type', selector: selector.trim(), text }
  }

  if (action === 'select') {
    const selector = obj['selector']
    const value = obj['value']
    if (typeof selector !== 'string' || selector.trim() === '') {
      throw new Error('select requires a non-empty "selector" string')
    }
    if (typeof value !== 'string') {
      throw new Error('select requires a "value" string')
    }
    return { action: 'select', selector: selector.trim(), value }
  }

  if (action === 'fill') {
    const fields = obj['fields']
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      throw new Error('fill requires a "fields" object (Record<string, string>)')
    }
    const entries = Object.entries(fields as Record<string, unknown>)
    if (entries.length === 0) {
      throw new Error('fill requires at least one field')
    }
    if (entries.length > MAX_FILL_FIELDS) {
      throw new Error(`fill supports max ${String(MAX_FILL_FIELDS)} fields`)
    }
    const validated: Record<string, string> = {}
    for (const [key, val] of entries) {
      if (typeof val !== 'string') {
        throw new Error(`fill field "${key}" must have a string value`)
      }
      validated[key] = val
    }
    return { action: 'fill', fields: validated }
  }

  if (action === 'cookies') {
    const cookieAction = obj['cookieAction']
    if (cookieAction !== 'read' && cookieAction !== 'set' && cookieAction !== 'clear') {
      throw new Error('cookies requires cookieAction: "read", "set", or "clear"')
    }
    if (cookieAction === 'set') {
      const name = obj['cookieName']
      const value = obj['cookieValue']
      const domain = obj['cookieDomain']
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('cookies set requires a non-empty "cookieName"')
      }
      if (typeof value !== 'string') {
        throw new Error('cookies set requires a "cookieValue" string')
      }
      if (typeof domain !== 'string' || domain.trim() === '') {
        throw new Error('cookies set requires a non-empty "cookieDomain"')
      }
      return {
        action: 'cookies',
        cookieAction: 'set',
        cookieName: name.trim(),
        cookieValue: value,
        cookieDomain: domain.trim(),
      }
    }
    return { action: 'cookies', cookieAction }
  }

  if (action === 'waitFor') {
    const waitType = obj['waitType']
    if (waitType !== 'selector' && waitType !== 'url' && waitType !== 'load') {
      throw new Error('waitFor requires waitType: "selector", "url", or "load"')
    }
    if (waitType === 'selector') {
      const selector = obj['selector']
      if (typeof selector !== 'string' || selector.trim() === '') {
        throw new Error('waitFor selector requires a non-empty "selector" string')
      }
      return { action: 'waitFor', waitType: 'selector', selector: selector.trim() }
    }
    if (waitType === 'url') {
      const url = obj['url']
      if (typeof url !== 'string' || url.trim() === '') {
        throw new Error('waitFor url requires a non-empty "url" string')
      }
      // Validate URL scheme
      validateBrowserUrl(url.trim())
      return { action: 'waitFor', waitType: 'url', url: url.trim() }
    }
    const state = typeof obj['state'] === 'string' ? obj['state'].trim() : 'load'
    return { action: 'waitFor', waitType: 'load', state }
  }

  if (action === 'openSession') {
    const domain = obj['domain']
    if (typeof domain !== 'string' || domain.trim() === '') {
      throw new Error('openSession requires a non-empty "domain" string')
    }
    return { action: 'openSession', domain: domain.trim() }
  }

  if (action === 'closeSession') {
    const domain = obj['domain']
    if (typeof domain !== 'string' || domain.trim() === '') {
      throw new Error('closeSession requires a non-empty "domain" string')
    }
    return { action: 'closeSession', domain: domain.trim() }
  }

  if (action === 'fillCredential') {
    const selector = obj['selector']
    if (typeof selector !== 'string' || selector.trim() === '') {
      throw new Error('fillCredential requires a non-empty "selector" string')
    }
    return { action: 'fillCredential', selector: selector.trim() }
  }

  if (action === 'healthCheck') {
    return { action: 'healthCheck' }
  }

  throw new Error(
    'action must be "openPage", "screenshot", "fillForm", "clickElement", "snapshot", "type", "select", "fill", "cookies", "waitFor", "openSession", "closeSession", "fillCredential", or "healthCheck"',
  )
}

// ---------------------------------------------------------------------------
// CredentialResolver — secure credential injection
// ---------------------------------------------------------------------------

export interface CredentialResolver {
  resolve(currentUrl: string): Promise<string>
}

let credentialResolver: CredentialResolver | null = null

export function setCredentialResolver(r: CredentialResolver): void {
  credentialResolver = r
}

// ---------------------------------------------------------------------------
// Browser lifecycle (persistent context singleton)
// ---------------------------------------------------------------------------

let contextInstance: PlaywrightBrowserContext | null = null
let pageInstance: PlaywrightPage | null = null
let playwrightLoader: (() => Promise<PlaywrightModule>) | null = null

// Session state (domain-specific persistent context)
let sessionPage: PlaywrightPage | null = null
let sessionDomain: string | null = null
let sessionTimer: ReturnType<typeof setTimeout> | null = null

/** Override for testing — inject a custom playwright loader. */
function setPlaywrightLoader(loader: (() => Promise<PlaywrightModule>) | null): void {
  playwrightLoader = loader
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  if (playwrightLoader !== null) {
    return playwrightLoader()
  }
  // Variable-based path prevents TS2307 — playwright is a runtime dependency
  // installed on the desktop, not a compile-time package dependency.
  const moduleName = 'playwright'
  try {
    const mod: PlaywrightModule = await (
      import(/* webpackIgnore: true */ moduleName) as Promise<PlaywrightModule>
    )
    return mod
  } catch {
    throw new Error(
      'Browser-Automatisierung nicht verfuegbar. Das Paket "playwright" ist nicht installiert.',
    )
  }
}

async function getContext(): Promise<PlaywrightBrowserContext> {
  if (contextInstance !== null) {
    // Reconnect check: if newPage() throws, context is dead
    try {
      const probe = await contextInstance.newPage()
      await probe.close()
    } catch {
      contextInstance = null
    }
  }
  if (contextInstance === null) {
    const userDataDir =
      process.env['KI_BROWSER_PROFILE'] ??
      join(homedir(), '.ki-assistent', 'browser-profile')
    mkdirSync(userDataDir, { recursive: true })
    const pw = await loadPlaywright()
    contextInstance = await pw.chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    })
  }
  return contextInstance
}

async function getPage(): Promise<PlaywrightPage> {
  // Domain session page takes priority
  if (sessionDomain !== null && sessionPage !== null && !sessionPage.isClosed()) {
    return sessionPage
  }

  if (pageInstance !== null && !pageInstance.isClosed()) {
    return pageInstance
  }

  const ctx = await getContext()
  pageInstance = await ctx.newPage()
  return pageInstance
}

/** Close persistent session — internal helper. */
async function closeSessionInternal(): Promise<void> {
  if (sessionTimer !== null) {
    clearTimeout(sessionTimer)
    sessionTimer = null
  }
  if (sessionPage !== null) {
    try { await sessionPage.close() } catch { /* already closed */ }
    sessionPage = null
  }
  if (contextInstance !== null) {
    try { await contextInstance.close() } catch { /* already closed */ }
    contextInstance = null
  }
  sessionDomain = null
}

/** Reset browser state — exported for testing. */
async function closeBrowser(): Promise<void> {
  await closeSessionInternal()
  if (pageInstance !== null) {
    try { await pageInstance.close() } catch { /* already closed */ }
    pageInstance = null
  }
  if (contextInstance !== null) {
    try { await contextInstance.close() } catch { /* already closed */ }
    contextInstance = null
  }
}

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${String(ms)}ms`))
    }, ms)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

async function executeOpenPage(args: OpenPageArgs): Promise<AgentToolResult> {
  checkRateLimit()
  const parsed = validateBrowserUrl(args.url)
  const page = await getPage()

  await withTimeout(
    page.goto(parsed.href, { timeout: ACTION_TIMEOUT_MS, waitUntil: 'domcontentloaded' }),
    ACTION_TIMEOUT_MS,
    'openPage',
  )

  const title = await page.title()
  const currentUrl = page.url()

  return textResult(JSON.stringify({ loaded: true, title, url: currentUrl }))
}

async function executeScreenshot(): Promise<AgentToolResult> {
  checkRateLimit()
  const page = await getPage()

  const buffer = await withTimeout(
    page.screenshot({ fullPage: true, type: 'png' }),
    ACTION_TIMEOUT_MS,
    'screenshot',
  )

  const base64 = buffer.toString('base64')

  return {
    content: [{ type: 'image', data: base64, mimeType: 'image/png' }],
  }
}

async function executeFillForm(args: FillFormArgs): Promise<AgentToolResult> {
  checkRateLimit()
  const page = await getPage()

  await withTimeout(
    page.fill(args.selector, args.value, { timeout: ACTION_TIMEOUT_MS }),
    ACTION_TIMEOUT_MS,
    'fillForm',
  )

  return textResult(JSON.stringify({ filled: true, selector: args.selector }))
}

async function executeClickElement(args: ClickElementArgs): Promise<AgentToolResult> {
  checkRateLimit()
  const page = await getPage()

  await withTimeout(
    page.click(args.selector, { timeout: ACTION_TIMEOUT_MS }),
    ACTION_TIMEOUT_MS,
    'clickElement',
  )

  return textResult(JSON.stringify({ clicked: true, selector: args.selector }))
}

// ---------------------------------------------------------------------------
// Snapshot sanitization — post-processing on accessibility tree JSON
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-misleading-character-class
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/g

interface AccessibilityNode {
  role?: string
  name?: string
  description?: string
  value?: string
  hidden?: boolean
  children?: AccessibilityNode[]
  [key: string]: unknown
}

function sanitizeString(s: string): { result: string; zwCount: number } {
  const matches = s.match(ZERO_WIDTH_RE)
  const zwCount = matches !== null ? matches.length : 0
  return { result: s.replace(ZERO_WIDTH_RE, ''), zwCount }
}

function sanitizeNode(node: AccessibilityNode): AccessibilityNode | null {
  if (node.hidden === true) return null

  let totalZw = 0
  const sanitized: AccessibilityNode = {}

  for (const [key, val] of Object.entries(node)) {
    if (key === 'children') continue
    if ((key === 'name' || key === 'description' || key === 'value') && typeof val === 'string') {
      const { result, zwCount } = sanitizeString(val)
      totalZw += zwCount
      if (totalZw > 3) return null
      sanitized[key] = result
    } else {
      sanitized[key] = val
    }
  }

  const children: AccessibilityNode[] = []
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const cleaned = sanitizeNode(child as AccessibilityNode)
      if (cleaned !== null) children.push(cleaned)
    }
  }
  sanitized.children = children

  return sanitized
}

async function executeSnapshot(): Promise<AgentToolResult> {
  checkRateLimit()
  const page = await getPage()

  const rawTree = await withTimeout(
    page.accessibility.snapshot(),
    ACTION_TIMEOUT_MS,
    'snapshot',
  ) as AccessibilityNode | null

  const sanitized = rawTree !== null ? sanitizeNode(rawTree) : null
  let serialized = JSON.stringify(sanitized)
  if (serialized.length > MAX_SNAPSHOT_LENGTH) {
    serialized = serialized.slice(0, MAX_SNAPSHOT_LENGTH) + '...(truncated)'
  }

  const nonce = randomBytes(8).toString('hex')
  const output =
    `--- BROWSER_CONTENT_START nonce=${nonce} origin=${page.url()} ---\n` +
    serialized +
    `\n--- BROWSER_CONTENT_END nonce=${nonce} ---`

  return textResult(output)
}

async function executeType(args: TypeArgs): Promise<AgentToolResult> {
  checkRateLimit()
  const page = await getPage()

  await withTimeout(
    page.type(args.selector, args.text, { timeout: ACTION_TIMEOUT_MS }),
    ACTION_TIMEOUT_MS,
    'type',
  )

  return textResult(JSON.stringify({ typed: true, selector: args.selector }))
}

async function executeSelect(args: SelectArgs): Promise<AgentToolResult> {
  checkRateLimit()
  const page = await getPage()

  const selected = await withTimeout(
    page.selectOption(args.selector, args.value),
    ACTION_TIMEOUT_MS,
    'select',
  )

  return textResult(JSON.stringify({ selected: true, selector: args.selector, values: selected }))
}

async function executeFill(args: FillArgs): Promise<AgentToolResult> {
  checkRateLimit()
  const page = await getPage()

  let filledCount = 0
  for (const [fieldName, fieldValue] of Object.entries(args.fields)) {
    const locator = page.getByLabel(fieldName)
    await withTimeout(
      locator.fill(fieldValue, { timeout: ACTION_TIMEOUT_MS }),
      ACTION_TIMEOUT_MS,
      `fill:${fieldName}`,
    )
    filledCount++
  }

  return textResult(JSON.stringify({ filled: true, fieldsCount: filledCount }))
}

async function executeCookies(args: CookiesArgs): Promise<AgentToolResult> {
  checkRateLimit()
  const page = await getPage()
  const ctx = page.context()

  if (args.cookieAction === 'read') {
    const cookies = await ctx.cookies()
    return textResult(JSON.stringify({ cookies }))
  }

  if (args.cookieAction === 'set') {
    await ctx.addCookies([{
      name: args.cookieName!,
      value: args.cookieValue!,
      domain: args.cookieDomain!,
      path: '/',
    }])
    return textResult(JSON.stringify({ set: true, name: args.cookieName }))
  }

  // clear
  await ctx.clearCookies()
  return textResult(JSON.stringify({ cleared: true }))
}

async function executeWaitFor(args: WaitForArgs): Promise<AgentToolResult> {
  checkRateLimit()
  const page = await getPage()

  if (args.waitType === 'selector') {
    await withTimeout(
      page.waitForSelector(args.selector!, { timeout: ACTION_TIMEOUT_MS }),
      ACTION_TIMEOUT_MS,
      'waitForSelector',
    )
    return textResult(JSON.stringify({ waited: true, type: 'selector', selector: args.selector }))
  }

  if (args.waitType === 'url') {
    await withTimeout(
      page.waitForURL(args.url!, { timeout: ACTION_TIMEOUT_MS }),
      ACTION_TIMEOUT_MS,
      'waitForURL',
    )
    return textResult(JSON.stringify({ waited: true, type: 'url', url: args.url }))
  }

  // load
  await withTimeout(
    page.waitForLoadState(args.state),
    ACTION_TIMEOUT_MS,
    'waitForLoadState',
  )
  return textResult(JSON.stringify({ waited: true, type: 'load', state: args.state }))
}

// ---------------------------------------------------------------------------
// Session actions
// ---------------------------------------------------------------------------

async function executeOpenSession(args: OpenSessionArgs): Promise<AgentToolResult> {
  checkRateLimit()
  const domain = validateDomain(args.domain)

  // Close any existing context (default or previous session)
  await closeSessionInternal()
  if (pageInstance !== null) {
    try { await pageInstance.close() } catch { /* ignore */ }
    pageInstance = null
  }
  if (contextInstance !== null) {
    try { await contextInstance.close() } catch { /* ignore */ }
    contextInstance = null
  }

  const profileDir = getSessionProfileDir(domain)
  mkdirSync(profileDir, { recursive: true })

  const pw = await loadPlaywright()
  contextInstance = await pw.chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const existingPages = contextInstance.pages()
  sessionPage = existingPages.length > 0
    ? existingPages[0] as PlaywrightPage
    : await contextInstance.newPage()
  sessionDomain = domain

  // Auto-close after 10 minutes
  sessionTimer = setTimeout(() => {
    void closeSessionInternal()
  }, SESSION_TIMEOUT_MS)

  return textResult(JSON.stringify({
    sessionOpened: true,
    domain,
    message: 'Browser ist offen. Logge dich ein und sage mir Bescheid wenn du fertig bist.',
  }))
}

async function executeCloseSession(args: CloseSessionArgs): Promise<AgentToolResult> {
  checkRateLimit()
  const domain = validateDomain(args.domain)

  if (sessionDomain === null) {
    throw new Error('No active browser session')
  }
  if (sessionDomain !== domain) {
    throw new Error(`Active session is for "${sessionDomain}", not "${domain}"`)
  }

  await closeSessionInternal()

  return textResult(JSON.stringify({ sessionClosed: true, domain }))
}

// ---------------------------------------------------------------------------
// fillCredential + healthCheck
// ---------------------------------------------------------------------------

async function executeFillCredential(args: FillCredentialArgs): Promise<AgentToolResult> {
  checkRateLimit()
  if (credentialResolver === null) {
    throw new Error('Kein CredentialResolver registriert')
  }
  const page = await getPage()
  const currentUrl = page.url()
  let value = await credentialResolver.resolve(currentUrl)
  await page.fill(args.selector, value, { timeout: ACTION_TIMEOUT_MS })
  value = '' // Minimize plaintext lifetime
  return textResult(JSON.stringify({ filled: true, selector: args.selector }))
}

async function executeHealthCheck(): Promise<AgentToolResult> {
  return textResult(JSON.stringify({
    healthy: contextInstance !== null,
    url: pageInstance !== null && !pageInstance.isClosed()
      ? pageInstance.url() : null,
    title: pageInstance !== null && !pageInstance.isClosed()
      ? await pageInstance.title().catch(() => null) : null,
  }))
}

// ---------------------------------------------------------------------------
// getCurrentPageUrl
// ---------------------------------------------------------------------------

export function getCurrentPageUrl(): string | null {
  return pageInstance !== null && !pageInstance.isClosed()
    ? pageInstance.url() : null
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description:
        'Action to perform',
      enum: ['openPage', 'screenshot', 'fillForm', 'clickElement', 'snapshot', 'type', 'select', 'fill', 'cookies', 'waitFor', 'openSession', 'closeSession', 'fillCredential', 'healthCheck'],
    },
    url: {
      type: 'string',
      description: 'URL to navigate to (openPage) or wait for (waitFor url)',
    },
    selector: {
      type: 'string',
      description: 'CSS selector for the target element',
    },
    value: {
      type: 'string',
      description: 'Value to fill or select',
    },
    text: {
      type: 'string',
      description: 'Text to type (type action)',
    },
    fields: {
      type: 'object',
      description: 'Label→value map for batch form fill (fill action)',
    },
    cookieAction: {
      type: 'string',
      description: 'Cookie operation: read, set, or clear',
      enum: ['read', 'set', 'clear'],
    },
    cookieName: {
      type: 'string',
      description: 'Cookie name (cookies set)',
    },
    cookieValue: {
      type: 'string',
      description: 'Cookie value (cookies set)',
    },
    cookieDomain: {
      type: 'string',
      description: 'Cookie domain (cookies set)',
    },
    waitType: {
      type: 'string',
      description: 'Wait type: selector, url, or load',
      enum: ['selector', 'url', 'load'],
    },
    state: {
      type: 'string',
      description: 'Load state to wait for (waitFor load): load, domcontentloaded, networkidle',
    },
    domain: {
      type: 'string',
      description: 'Domain for persistent browser session (e.g. "github.com")',
    },
  },
  required: ['action'],
}

export const browserTool: ExtendedAgentTool = {
  name: 'browser',
  description:
    'Interact with web pages via persistent browser context. Use for URL content, screenshots, and form interaction. Not for launching desktop apps. ' +
    'Actions: openPage(url), screenshot(), fillForm(selector, value), clickElement(selector), snapshot() reads sanitized accessibility tree, type(selector, text), select(selector, value), fill(fields) batch form fill by label, cookies(cookieAction) read/set/clear cookies, waitFor(waitType) wait for selector/url/load, ' +
    'openSession(domain) opens a visible browser with domain-specific profile for manual login, closeSession(domain) closes it, fillCredential(selector) fills credential via resolver, healthCheck() reports context status. Rate limited to 30/min.',
  parameters,
  permissions: ['browser:navigate', 'browser:interact'],
  requiresConfirmation: true,
  defaultRiskTier: 3,
  riskTiers: { snapshot: 2, cookies: 2, openSession: 2, closeSession: 1, openPage: 3, fillForm: 3, clickElement: 3, type: 3, select: 3, fill: 3, waitFor: 3, fillCredential: 3, healthCheck: 0 },
  runsOn: 'desktop',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    // SECURITY: page.evaluate is intentionally not used for DOM mutation.
    // Sanitization runs on accessibility tree JSON only (post-processing).
    // Credentials flow via fillCredential + CredentialResolver only.
    switch (parsed.action) {
      case 'openPage':
        return executeOpenPage(parsed)
      case 'screenshot':
        return executeScreenshot()
      case 'fillForm':
        return executeFillForm(parsed)
      case 'clickElement':
        return executeClickElement(parsed)
      case 'snapshot':
        return executeSnapshot()
      case 'type':
        return executeType(parsed)
      case 'select':
        return executeSelect(parsed)
      case 'fill':
        return executeFill(parsed)
      case 'cookies':
        return executeCookies(parsed)
      case 'waitFor':
        return executeWaitFor(parsed)
      case 'openSession':
        return executeOpenSession(parsed)
      case 'closeSession':
        return executeCloseSession(parsed)
      case 'fillCredential':
        return executeFillCredential(parsed)
      case 'healthCheck':
        return executeHealthCheck()
    }
  },
}

export {
  validateBrowserUrl,
  validateDomain,
  parseArgs,
  closeBrowser,
  setPlaywrightLoader,
  _resetRateLimit,
}
