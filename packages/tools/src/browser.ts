/**
 * Browser tool — navigate pages, take screenshots, fill forms, click elements.
 * Uses Playwright headless Chromium loaded via dynamic import.
 *
 * URL policy: Only http:// and https:// URLs are permitted.
 * Blocked: file://, javascript:, data:, and all other schemes.
 *
 * Browser instance is reused across invocations.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Minimal Playwright interfaces (avoids compile-time dependency)
// ---------------------------------------------------------------------------

interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>
  close(): Promise<void>
  isConnected(): boolean
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
}

interface PlaywrightChromium {
  launch(options?: { headless?: boolean; args?: string[] }): Promise<PlaywrightBrowser>
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

type BrowserArgs = OpenPageArgs | ScreenshotArgs | FillFormArgs | ClickElementArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

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

  return parsed
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

  throw new Error(
    'action must be "openPage", "screenshot", "fillForm", or "clickElement"',
  )
}

// ---------------------------------------------------------------------------
// Browser lifecycle (reused singleton)
// ---------------------------------------------------------------------------

let browserInstance: PlaywrightBrowser | null = null
let pageInstance: PlaywrightPage | null = null
let playwrightLoader: (() => Promise<PlaywrightModule>) | null = null

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
  const mod: PlaywrightModule = await (
    import(/* webpackIgnore: true */ moduleName) as Promise<PlaywrightModule>
  )
  return mod
}

async function getBrowser(): Promise<PlaywrightBrowser> {
  if (browserInstance !== null && browserInstance.isConnected()) {
    return browserInstance
  }

  const pw = await loadPlaywright()
  browserInstance = await pw.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  return browserInstance
}

async function getPage(): Promise<PlaywrightPage> {
  if (pageInstance !== null && !pageInstance.isClosed()) {
    return pageInstance
  }

  const browser = await getBrowser()
  pageInstance = await browser.newPage()
  return pageInstance
}

/** Reset browser state — exported for testing. */
async function closeBrowser(): Promise<void> {
  if (pageInstance !== null) {
    try { await pageInstance.close() } catch { /* already closed */ }
    pageInstance = null
  }
  if (browserInstance !== null) {
    try { await browserInstance.close() } catch { /* already closed */ }
    browserInstance = null
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
// Action executors
// ---------------------------------------------------------------------------

async function executeOpenPage(args: OpenPageArgs): Promise<AgentToolResult> {
  const parsed = validateBrowserUrl(args.url)
  const page = await getPage()

  await withTimeout(
    page.goto(parsed.href, { timeout: ACTION_TIMEOUT_MS, waitUntil: 'domcontentloaded' }),
    ACTION_TIMEOUT_MS,
    'openPage',
  )

  const title = await page.title()
  const currentUrl = page.url()

  return {
    content: [
      { type: 'text', text: JSON.stringify({ loaded: true, title, url: currentUrl }) },
    ],
  }
}

async function executeScreenshot(): Promise<AgentToolResult> {
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
  const page = await getPage()

  await withTimeout(
    page.fill(args.selector, args.value, { timeout: ACTION_TIMEOUT_MS }),
    ACTION_TIMEOUT_MS,
    'fillForm',
  )

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ filled: true, selector: args.selector }),
      },
    ],
  }
}

async function executeClickElement(args: ClickElementArgs): Promise<AgentToolResult> {
  const page = await getPage()

  await withTimeout(
    page.click(args.selector, { timeout: ACTION_TIMEOUT_MS }),
    ACTION_TIMEOUT_MS,
    'clickElement',
  )

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ clicked: true, selector: args.selector }),
      },
    ],
  }
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
        'Action to perform: "openPage", "screenshot", "fillForm", or "clickElement"',
      enum: ['openPage', 'screenshot', 'fillForm', 'clickElement'],
    },
    url: {
      type: 'string',
      description: 'URL to navigate to (openPage, must be http:// or https://)',
    },
    selector: {
      type: 'string',
      description: 'CSS selector for the target element (fillForm, clickElement)',
    },
    value: {
      type: 'string',
      description: 'Value to fill into the form field (fillForm)',
    },
  },
  required: ['action'],
}

export const browserTool: ExtendedAgentTool = {
  name: 'browser',
  description:
    'Control a headless Chromium browser. Actions: openPage(url) loads a page, screenshot() captures the current page as PNG, fillForm(selector, value) fills a form field, clickElement(selector) clicks an element. Only http:// and https:// URLs allowed.',
  parameters,
  permissions: ['browser:navigate', 'browser:interact'],
  requiresConfirmation: true,
  runsOn: 'desktop',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'openPage':
        return executeOpenPage(parsed)
      case 'screenshot':
        return executeScreenshot()
      case 'fillForm':
        return executeFillForm(parsed)
      case 'clickElement':
        return executeClickElement(parsed)
    }
  },
}

export {
  validateBrowserUrl,
  parseArgs,
  closeBrowser,
  setPlaywrightLoader,
}
