import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertNoEval } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/browser.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock Playwright objects
// ---------------------------------------------------------------------------

const mockGoto = vi.fn()
const mockScreenshot = vi.fn()
const mockFill = vi.fn()
const mockClick = vi.fn()
const mockTitle = vi.fn()
const mockUrl = vi.fn()
const mockPageClose = vi.fn()
const mockPageIsClosed = vi.fn()
const mockBrowserClose = vi.fn()
const mockBrowserIsConnected = vi.fn()
const mockNewPage = vi.fn()
const mockLaunch = vi.fn()
const mockAccessibilitySnapshot = vi.fn()
const mockSelectOption = vi.fn()
const mockType = vi.fn()
const mockWaitForSelector = vi.fn()
const mockWaitForURL = vi.fn()
const mockWaitForLoadState = vi.fn()
const mockGetByLabel = vi.fn()
const mockLocatorFill = vi.fn()
const mockContextCookies = vi.fn()
const mockContextAddCookies = vi.fn()
const mockContextClearCookies = vi.fn()

function createMockContext(): Record<string, unknown> {
  return {
    cookies: mockContextCookies,
    addCookies: mockContextAddCookies,
    clearCookies: mockContextClearCookies,
  }
}

function createMockPage(): Record<string, unknown> {
  return {
    goto: mockGoto,
    screenshot: mockScreenshot,
    fill: mockFill,
    click: mockClick,
    title: mockTitle,
    url: mockUrl,
    close: mockPageClose,
    isClosed: mockPageIsClosed,
    accessibility: { snapshot: mockAccessibilitySnapshot },
    selectOption: mockSelectOption,
    type: mockType,
    waitForSelector: mockWaitForSelector,
    waitForURL: mockWaitForURL,
    waitForLoadState: mockWaitForLoadState,
    getByLabel: mockGetByLabel,
    context: () => createMockContext(),
  }
}

function createMockBrowser(): Record<string, unknown> {
  return {
    newPage: mockNewPage,
    close: mockBrowserClose,
    isConnected: mockBrowserIsConnected,
  }
}

function setupDefaultMocks(): void {
  const mockPage = createMockPage()
  const mockBrowser = createMockBrowser()

  mockBrowserIsConnected.mockReturnValue(true)
  mockPageIsClosed.mockReturnValue(false)
  mockNewPage.mockResolvedValue(mockPage)
  mockLaunch.mockResolvedValue(mockBrowser)
  mockTitle.mockResolvedValue('Example Page')
  mockUrl.mockReturnValue('https://example.com/')
  mockGoto.mockResolvedValue(null)
  mockFill.mockResolvedValue(undefined)
  mockClick.mockResolvedValue(undefined)
  mockPageClose.mockResolvedValue(undefined)
  mockBrowserClose.mockResolvedValue(undefined)
  mockAccessibilitySnapshot.mockResolvedValue({ role: 'WebArea', name: '', children: [] })
  mockSelectOption.mockResolvedValue(['option1'])
  mockType.mockResolvedValue(undefined)
  mockWaitForSelector.mockResolvedValue(null)
  mockWaitForURL.mockResolvedValue(undefined)
  mockWaitForLoadState.mockResolvedValue(undefined)
  mockGetByLabel.mockReturnValue({ fill: mockLocatorFill })
  mockLocatorFill.mockResolvedValue(undefined)
  mockContextCookies.mockResolvedValue([{ name: 'sid', value: 'abc', domain: '.example.com' }])
  mockContextAddCookies.mockResolvedValue(undefined)
  mockContextClearCookies.mockResolvedValue(undefined)

  const screenshotBuffer = Buffer.from('fake-png-data')
  mockScreenshot.mockResolvedValue(screenshotBuffer)
}

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

const {
  browserTool,
  validateBrowserUrl,
  parseArgs,
  closeBrowser,
  setPlaywrightLoader,
  _resetRateLimit,
} = await import('../src/browser')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTextContent(result: import('../src/types').AgentToolResult): string {
  const first = result.content[0]
  if (first === undefined || first.type !== 'text') {
    throw new Error('Expected text content in result')
  }
  return first.text
}

function getImageContent(result: import('../src/types').AgentToolResult): {
  data: string
  mimeType: string
} {
  const first = result.content[0]
  if (first === undefined || first.type !== 'image') {
    throw new Error('Expected image content in result')
  }
  return { data: first.data, mimeType: first.mimeType }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('browser tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
    _resetRateLimit()

    setPlaywrightLoader(async () => ({
      chromium: { launch: mockLaunch },
    }))
  })

  afterEach(async () => {
    await closeBrowser()
    setPlaywrightLoader(null)
  })

  // -------------------------------------------------------------------------
  // parseArgs
  // -------------------------------------------------------------------------

  describe('parseArgs', () => {
    it('parses openPage args', () => {
      const result = parseArgs({ action: 'openPage', url: 'https://example.com' })
      expect(result).toEqual({ action: 'openPage', url: 'https://example.com' })
    })

    it('parses screenshot args', () => {
      const result = parseArgs({ action: 'screenshot' })
      expect(result).toEqual({ action: 'screenshot' })
    })

    it('parses fillForm args', () => {
      const result = parseArgs({
        action: 'fillForm',
        selector: '#email',
        value: 'test@example.com',
      })
      expect(result).toEqual({
        action: 'fillForm',
        selector: '#email',
        value: 'test@example.com',
      })
    })

    it('parses clickElement args', () => {
      const result = parseArgs({ action: 'clickElement', selector: 'button.submit' })
      expect(result).toEqual({ action: 'clickElement', selector: 'button.submit' })
    })

    it('parses snapshot args', () => {
      expect(parseArgs({ action: 'snapshot' })).toEqual({ action: 'snapshot' })
    })

    it('parses type args', () => {
      const result = parseArgs({ action: 'type', selector: '#input', text: 'hello' })
      expect(result).toEqual({ action: 'type', selector: '#input', text: 'hello' })
    })

    it('parses select args', () => {
      const result = parseArgs({ action: 'select', selector: '#dropdown', value: 'opt1' })
      expect(result).toEqual({ action: 'select', selector: '#dropdown', value: 'opt1' })
    })

    it('parses fill args', () => {
      const result = parseArgs({ action: 'fill', fields: { Name: 'John', Email: 'john@test.com' } })
      expect(result).toEqual({ action: 'fill', fields: { Name: 'John', Email: 'john@test.com' } })
    })

    it('parses cookies read args', () => {
      expect(parseArgs({ action: 'cookies', cookieAction: 'read' }))
        .toEqual({ action: 'cookies', cookieAction: 'read' })
    })

    it('parses cookies set args', () => {
      const result = parseArgs({
        action: 'cookies', cookieAction: 'set',
        cookieName: 'sid', cookieValue: 'abc', cookieDomain: '.example.com',
      })
      expect(result).toHaveProperty('cookieAction', 'set')
      expect(result).toHaveProperty('cookieName', 'sid')
    })

    it('parses cookies clear args', () => {
      expect(parseArgs({ action: 'cookies', cookieAction: 'clear' }))
        .toEqual({ action: 'cookies', cookieAction: 'clear' })
    })

    it('parses waitFor selector args', () => {
      const result = parseArgs({ action: 'waitFor', waitType: 'selector', selector: '#loaded' })
      expect(result).toEqual({ action: 'waitFor', waitType: 'selector', selector: '#loaded' })
    })

    it('parses waitFor url args', () => {
      const result = parseArgs({ action: 'waitFor', waitType: 'url', url: 'https://example.com/done' })
      expect(result).toEqual({ action: 'waitFor', waitType: 'url', url: 'https://example.com/done' })
    })

    it('parses waitFor load args', () => {
      const result = parseArgs({ action: 'waitFor', waitType: 'load' })
      expect(result).toEqual({ action: 'waitFor', waitType: 'load', state: 'load' })
    })

    it('rejects non-object args', () => {
      expect(() => parseArgs('string')).toThrow('Arguments must be an object')
    })

    it('rejects null args', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'unknown' })).toThrow('action must be')
    })

    it('rejects openPage without url', () => {
      expect(() => parseArgs({ action: 'openPage' })).toThrow('url')
    })

    it('rejects fillForm without selector', () => {
      expect(() => parseArgs({ action: 'fillForm', value: 'x' })).toThrow('selector')
    })

    it('rejects fillForm without value', () => {
      expect(() =>
        parseArgs({ action: 'fillForm', selector: '#x' }),
      ).toThrow('value')
    })

    it('rejects clickElement without selector', () => {
      expect(() => parseArgs({ action: 'clickElement' })).toThrow('selector')
    })

    it('rejects type without selector', () => {
      expect(() => parseArgs({ action: 'type', text: 'x' })).toThrow('selector')
    })

    it('rejects type without text', () => {
      expect(() => parseArgs({ action: 'type', selector: '#x' })).toThrow('"text"')
    })

    it('rejects select without selector', () => {
      expect(() => parseArgs({ action: 'select', value: 'x' })).toThrow('selector')
    })

    it('rejects fill with empty fields', () => {
      expect(() => parseArgs({ action: 'fill', fields: {} })).toThrow('at least one field')
    })

    it('rejects fill with non-object fields', () => {
      expect(() => parseArgs({ action: 'fill', fields: 'x' })).toThrow('"fields" object')
    })

    it('rejects cookies with invalid cookieAction', () => {
      expect(() => parseArgs({ action: 'cookies', cookieAction: 'hack' })).toThrow('cookieAction')
    })

    it('rejects cookies set without name', () => {
      expect(() => parseArgs({ action: 'cookies', cookieAction: 'set', cookieValue: 'x', cookieDomain: '.x' }))
        .toThrow('cookieName')
    })

    it('rejects waitFor with invalid waitType', () => {
      expect(() => parseArgs({ action: 'waitFor', waitType: 'hack' })).toThrow('waitType')
    })

    it('rejects waitFor url with file:// scheme', () => {
      expect(() => parseArgs({ action: 'waitFor', waitType: 'url', url: 'file:///etc/passwd' }))
        .toThrow('Blocked URL scheme')
    })

    it('trims whitespace from url and selector', () => {
      const openPage = parseArgs({ action: 'openPage', url: '  https://example.com  ' })
      expect(openPage).toHaveProperty('url', 'https://example.com')

      const click = parseArgs({ action: 'clickElement', selector: '  #btn  ' })
      expect(click).toHaveProperty('selector', '#btn')
    })
  })

  // -------------------------------------------------------------------------
  // validateBrowserUrl
  // -------------------------------------------------------------------------

  describe('validateBrowserUrl', () => {
    it('allows https:// URLs', () => {
      expect(() => validateBrowserUrl('https://example.com')).not.toThrow()
    })

    it('allows http:// URLs', () => {
      expect(() => validateBrowserUrl('http://example.com')).not.toThrow()
    })

    it('blocks file:// URLs', () => {
      expect(() => validateBrowserUrl('file:///etc/passwd')).toThrow(
        'Blocked URL scheme "file:"',
      )
    })

    it('blocks javascript: URLs', () => {
      expect(() => validateBrowserUrl('javascript:alert(1)')).toThrow(
        'Blocked URL scheme',
      )
    })

    it('blocks data: URLs', () => {
      expect(() => validateBrowserUrl('data:text/html,<h1>xss</h1>')).toThrow(
        'Blocked URL scheme "data:"',
      )
    })

    it('blocks ftp: URLs', () => {
      expect(() => validateBrowserUrl('ftp://files.example.com')).toThrow(
        'Blocked URL scheme "ftp:"',
      )
    })

    it('rejects invalid URLs', () => {
      expect(() => validateBrowserUrl('not-a-url')).toThrow('Invalid URL')
    })

    it('rejects URLs with embedded credentials', () => {
      expect(() =>
        validateBrowserUrl('https://user:pass@example.com'),
      ).toThrow('embedded credentials')
    })

    it('returns parsed URL object', () => {
      const parsed = validateBrowserUrl('https://example.com/path?q=1')
      expect(parsed.hostname).toBe('example.com')
      expect(parsed.pathname).toBe('/path')
    })
  })

  // -------------------------------------------------------------------------
  // openPage
  // -------------------------------------------------------------------------

  describe('openPage', () => {
    it('loads a page and returns title and url', async () => {
      mockTitle.mockResolvedValue('Example Domain')
      mockUrl.mockReturnValue('https://example.com/')

      const result = await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })

      const parsed = JSON.parse(getTextContent(result)) as {
        loaded: boolean
        title: string
        url: string
      }
      expect(parsed.loaded).toBe(true)
      expect(parsed.title).toBe('Example Domain')
      expect(parsed.url).toBe('https://example.com/')
    })

    it('calls page.goto with correct URL and options', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com/page',
      })

      expect(mockGoto).toHaveBeenCalledWith('https://example.com/page', {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      })
    })

    it('launches chromium headless on first call', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })

      expect(mockLaunch).toHaveBeenCalledWith({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    })

    it('rejects file:// URL', async () => {
      await expect(
        browserTool.execute({ action: 'openPage', url: 'file:///etc/passwd' }),
      ).rejects.toThrow('Blocked URL scheme "file:"')
    })

    it('rejects javascript: URL', async () => {
      await expect(
        browserTool.execute({ action: 'openPage', url: 'javascript:alert(1)' }),
      ).rejects.toThrow('Blocked URL scheme')
    })

    it('reuses browser instance across calls', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com/page2',
      })

      expect(mockLaunch).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // screenshot
  // -------------------------------------------------------------------------

  describe('screenshot', () => {
    it('returns base64 PNG image', async () => {
      const pngBytes = Buffer.from('fake-png-screenshot-data')
      mockScreenshot.mockResolvedValue(pngBytes)

      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })

      const result = await browserTool.execute({ action: 'screenshot' })
      const image = getImageContent(result)

      expect(image.mimeType).toBe('image/png')
      expect(image.data).toBe(pngBytes.toString('base64'))
    })

    it('takes fullPage screenshot', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })

      await browserTool.execute({ action: 'screenshot' })

      expect(mockScreenshot).toHaveBeenCalledWith({
        fullPage: true,
        type: 'png',
      })
    })
  })

  // -------------------------------------------------------------------------
  // fillForm
  // -------------------------------------------------------------------------

  describe('fillForm', () => {
    it('calls page.fill with selector and value', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })

      const result = await browserTool.execute({
        action: 'fillForm',
        selector: '#username',
        value: 'testuser',
      })

      expect(mockFill).toHaveBeenCalledWith('#username', 'testuser', {
        timeout: 30_000,
      })

      const parsed = JSON.parse(getTextContent(result)) as {
        filled: boolean
        selector: string
      }
      expect(parsed.filled).toBe(true)
      expect(parsed.selector).toBe('#username')
    })

    it('allows empty string as value', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })

      await browserTool.execute({
        action: 'fillForm',
        selector: '#field',
        value: '',
      })

      expect(mockFill).toHaveBeenCalledWith('#field', '', { timeout: 30_000 })
    })
  })

  // -------------------------------------------------------------------------
  // clickElement
  // -------------------------------------------------------------------------

  describe('clickElement', () => {
    it('calls page.click with selector', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })

      const result = await browserTool.execute({
        action: 'clickElement',
        selector: 'button.submit',
      })

      expect(mockClick).toHaveBeenCalledWith('button.submit', {
        timeout: 30_000,
      })

      const parsed = JSON.parse(getTextContent(result)) as {
        clicked: boolean
        selector: string
      }
      expect(parsed.clicked).toBe(true)
      expect(parsed.selector).toBe('button.submit')
    })
  })

  // -------------------------------------------------------------------------
  // snapshot (NEW)
  // -------------------------------------------------------------------------

  describe('snapshot', () => {
    it('returns accessibility tree and URL', async () => {
      mockAccessibilitySnapshot.mockResolvedValue({ role: 'WebArea', name: 'Page', children: [] })

      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      const result = await browserTool.execute({ action: 'snapshot' })
      const parsed = JSON.parse(getTextContent(result)) as { snapshot: unknown; url: string }

      expect(parsed.snapshot).toBeDefined()
      expect(parsed.url).toBe('https://example.com/')
    })

    it('calls page.accessibility.snapshot()', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      await browserTool.execute({ action: 'snapshot' })

      expect(mockAccessibilitySnapshot).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // type (NEW)
  // -------------------------------------------------------------------------

  describe('type', () => {
    it('calls page.type with selector and text', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })

      const result = await browserTool.execute({ action: 'type', selector: '#input', text: 'hello world' })
      expect(mockType).toHaveBeenCalledWith('#input', 'hello world', { timeout: 30_000 })

      const parsed = JSON.parse(getTextContent(result)) as { typed: boolean }
      expect(parsed.typed).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // select (NEW)
  // -------------------------------------------------------------------------

  describe('select', () => {
    it('calls page.selectOption', async () => {
      mockSelectOption.mockResolvedValue(['opt1'])

      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      const result = await browserTool.execute({ action: 'select', selector: '#dropdown', value: 'opt1' })

      expect(mockSelectOption).toHaveBeenCalledWith('#dropdown', 'opt1')
      const parsed = JSON.parse(getTextContent(result)) as { selected: boolean; values: string[] }
      expect(parsed.selected).toBe(true)
      expect(parsed.values).toEqual(['opt1'])
    })
  })

  // -------------------------------------------------------------------------
  // fill (NEW — batch form fill by label)
  // -------------------------------------------------------------------------

  describe('fill', () => {
    it('fills multiple fields by label', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })

      const result = await browserTool.execute({
        action: 'fill',
        fields: { Name: 'John', Email: 'john@test.com' },
      })

      expect(mockGetByLabel).toHaveBeenCalledWith('Name')
      expect(mockGetByLabel).toHaveBeenCalledWith('Email')
      expect(mockLocatorFill).toHaveBeenCalledTimes(2)

      const parsed = JSON.parse(getTextContent(result)) as { filled: boolean; fieldsCount: number }
      expect(parsed.filled).toBe(true)
      expect(parsed.fieldsCount).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // cookies (NEW)
  // -------------------------------------------------------------------------

  describe('cookies', () => {
    it('reads cookies', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })

      const result = await browserTool.execute({ action: 'cookies', cookieAction: 'read' })
      expect(mockContextCookies).toHaveBeenCalled()

      const parsed = JSON.parse(getTextContent(result)) as { cookies: unknown[] }
      expect(parsed.cookies).toHaveLength(1)
    })

    it('sets a cookie', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })

      const result = await browserTool.execute({
        action: 'cookies',
        cookieAction: 'set',
        cookieName: 'test',
        cookieValue: 'val',
        cookieDomain: '.example.com',
      })

      expect(mockContextAddCookies).toHaveBeenCalledWith([{
        name: 'test', value: 'val', domain: '.example.com', path: '/',
      }])

      const parsed = JSON.parse(getTextContent(result)) as { set: boolean }
      expect(parsed.set).toBe(true)
    })

    it('clears cookies', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })

      const result = await browserTool.execute({ action: 'cookies', cookieAction: 'clear' })
      expect(mockContextClearCookies).toHaveBeenCalled()

      const parsed = JSON.parse(getTextContent(result)) as { cleared: boolean }
      expect(parsed.cleared).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // waitFor (NEW)
  // -------------------------------------------------------------------------

  describe('waitFor', () => {
    it('waits for selector', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })

      const result = await browserTool.execute({ action: 'waitFor', waitType: 'selector', selector: '#loaded' })
      expect(mockWaitForSelector).toHaveBeenCalledWith('#loaded', { timeout: 30_000 })

      const parsed = JSON.parse(getTextContent(result)) as { waited: boolean; type: string }
      expect(parsed.waited).toBe(true)
      expect(parsed.type).toBe('selector')
    })

    it('waits for URL', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })

      const result = await browserTool.execute({
        action: 'waitFor', waitType: 'url', url: 'https://example.com/done',
      })
      expect(mockWaitForURL).toHaveBeenCalledWith('https://example.com/done', { timeout: 30_000 })

      const parsed = JSON.parse(getTextContent(result)) as { waited: boolean; type: string }
      expect(parsed.waited).toBe(true)
      expect(parsed.type).toBe('url')
    })

    it('waits for load state', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })

      const result = await browserTool.execute({ action: 'waitFor', waitType: 'load', state: 'networkidle' })
      expect(mockWaitForLoadState).toHaveBeenCalledWith('networkidle')

      const parsed = JSON.parse(getTextContent(result)) as { waited: boolean; state: string }
      expect(parsed.waited).toBe(true)
      expect(parsed.state).toBe('networkidle')
    })
  })

  // -------------------------------------------------------------------------
  // Rate limiting (NEW)
  // -------------------------------------------------------------------------

  describe('rate limiting', () => {
    it('allows 30 actions per minute', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })

      // We already used 1 action (openPage above), try 29 more
      for (let i = 0; i < 29; i++) {
        await browserTool.execute({ action: 'screenshot' })
      }

      // 31st action should fail
      await expect(
        browserTool.execute({ action: 'screenshot' }),
      ).rejects.toThrow('Rate limit')
    })
  })

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------

  describe('timeout', () => {
    it('aborts hanging page load after 30s', async () => {
      mockGoto.mockImplementation(
        () =>
          new Promise((_resolve) => {
            // Never resolves — simulates hanging page
          }),
      )

      await expect(
        browserTool.execute({
          action: 'openPage',
          url: 'https://hanging-page.example.com',
        }),
      ).rejects.toThrow('timed out after 30000ms')
    }, 35_000)
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('tool metadata', () => {
    it('has correct name', () => {
      expect(browserTool.name).toBe('browser')
    })

    it('has correct permissions', () => {
      expect(browserTool.permissions).toEqual([
        'browser:navigate',
        'browser:interact',
      ])
    })

    it('requires confirmation', () => {
      expect(browserTool.requiresConfirmation).toBe(true)
    })

    it('runs on desktop', () => {
      expect(browserTool.runsOn).toBe('desktop')
    })
  })

  // -------------------------------------------------------------------------
  // Browser reuse
  // -------------------------------------------------------------------------

  describe('browser reuse', () => {
    it('reuses page instance across actions', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })
      await browserTool.execute({ action: 'screenshot' })
      await browserTool.execute({
        action: 'clickElement',
        selector: '#btn',
      })

      expect(mockNewPage).toHaveBeenCalledTimes(1)
    })

    it('creates new page if previous was closed', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })

      // Simulate page being closed
      mockPageIsClosed.mockReturnValue(true)

      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com/new',
      })

      expect(mockNewPage).toHaveBeenCalledTimes(2)
    })

    it('creates new browser if previous was disconnected', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })

      // Simulate browser disconnected
      mockBrowserIsConnected.mockReturnValue(false)
      mockPageIsClosed.mockReturnValue(true)

      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com/new',
      })

      expect(mockLaunch).toHaveBeenCalledTimes(2)
    })
  })
})

// ---------------------------------------------------------------------------
// Security tests
// ---------------------------------------------------------------------------

describe('browser security', () => {
  it('contains no eval or code-execution patterns', () => {
    assertNoEval(sourceCode)
  })

  it('has rate limiting', () => {
    expect(sourceCode).toContain('MAX_ACTIONS_PER_MINUTE')
    expect(sourceCode).toContain('checkRateLimit')
  })

  it('has URL validation for waitFor', () => {
    expect(sourceCode).toContain('validateBrowserUrl')
  })
})
