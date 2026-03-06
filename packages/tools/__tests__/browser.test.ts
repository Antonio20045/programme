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
const mockNewPage = vi.fn()
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
const mockLaunchPersistentContext = vi.fn()
const mockContextClose = vi.fn()
const mockContextPages = vi.fn()

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

function createMockContext(): Record<string, unknown> {
  return {
    cookies: mockContextCookies,
    addCookies: mockContextAddCookies,
    clearCookies: mockContextClearCookies,
    newPage: mockNewPage,
    close: mockContextClose,
    isConnected: vi.fn().mockReturnValue(true),
    pages: mockContextPages,
  }
}

function setupDefaultMocks(): void {
  const mockPage = createMockPage()

  mockPageIsClosed.mockReturnValue(false)
  mockNewPage.mockResolvedValue(mockPage)
  mockTitle.mockResolvedValue('Example Page')
  mockUrl.mockReturnValue('https://example.com/')
  mockGoto.mockResolvedValue(null)
  mockFill.mockResolvedValue(undefined)
  mockClick.mockResolvedValue(undefined)
  mockPageClose.mockResolvedValue(undefined)
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

  // Context mocks
  mockContextClose.mockResolvedValue(undefined)
  mockContextPages.mockReturnValue([mockPage])
  mockLaunchPersistentContext.mockResolvedValue(createMockContext())
}

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

const {
  browserTool,
  validateBrowserUrl,
  validateDomain,
  parseArgs,
  closeBrowser,
  setPlaywrightLoader,
  _resetRateLimit,
  setCredentialResolver,
  getCurrentPageUrl,
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
      chromium: { launchPersistentContext: mockLaunchPersistentContext },
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

    it('parses fillCredential args', () => {
      const result = parseArgs({ action: 'fillCredential', selector: '#password' })
      expect(result).toEqual({ action: 'fillCredential', selector: '#password' })
    })

    it('rejects fillCredential without selector', () => {
      expect(() => parseArgs({ action: 'fillCredential' })).toThrow('selector')
    })

    it('parses healthCheck args', () => {
      expect(parseArgs({ action: 'healthCheck' })).toEqual({ action: 'healthCheck' })
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

    it('launches with persistent context', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })

      expect(mockLaunchPersistentContext).toHaveBeenCalledWith(
        expect.stringContaining('.ki-assistent/browser-profile'),
        {
          headless: true,
          args: ['--disable-blink-features=AutomationControlled'],
        },
      )
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

    it('reuses context across calls', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com/page2',
      })

      expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(1)
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
  // snapshot
  // -------------------------------------------------------------------------

  describe('snapshot', () => {
    it('returns sanitized accessibility tree with nonce envelope', async () => {
      mockAccessibilitySnapshot.mockResolvedValue({ role: 'WebArea', name: 'Page', children: [] })

      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      const result = await browserTool.execute({ action: 'snapshot' })
      const text = getTextContent(result)

      expect(text).toContain('--- BROWSER_CONTENT_START nonce=')
      expect(text).toContain('--- BROWSER_CONTENT_END nonce=')
    })

    it('nonce in header matches nonce in footer', async () => {
      mockAccessibilitySnapshot.mockResolvedValue({ role: 'WebArea', name: 'Test', children: [] })

      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      const result = await browserTool.execute({ action: 'snapshot' })
      const text = getTextContent(result)

      const headerMatch = text.match(/BROWSER_CONTENT_START nonce=(\w+)/)
      const footerMatch = text.match(/BROWSER_CONTENT_END nonce=(\w+)/)

      expect(headerMatch).not.toBeNull()
      expect(footerMatch).not.toBeNull()
      expect(headerMatch![1]).toBe(footerMatch![1])
    })

    it('strips zero-width chars from node names', async () => {
      mockAccessibilitySnapshot.mockResolvedValue({
        role: 'WebArea',
        name: 'Page\u200B\u200CTitle',
        children: [],
      })

      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      const result = await browserTool.execute({ action: 'snapshot' })
      const text = getTextContent(result)

      expect(text).toContain('"PageTitle"')
      expect(text).not.toContain('\u200B')
      expect(text).not.toContain('\u200C')
    })

    it('removes nodes with excessive zero-width chars (attack indicator)', async () => {
      mockAccessibilitySnapshot.mockResolvedValue({
        role: 'WebArea',
        name: 'Root',
        children: [{
          role: 'text',
          name: 'evil\u200B\u200C\u200D\uFEFF',
          children: [],
        }],
      })

      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      const result = await browserTool.execute({ action: 'snapshot' })
      const text = getTextContent(result)

      expect(text).not.toContain('evil')
    })

    it('calls page.accessibility.snapshot()', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      await browserTool.execute({ action: 'snapshot' })

      expect(mockAccessibilitySnapshot).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // type
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
  // select
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
  // fill (batch form fill by label)
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
  // cookies
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
  // waitFor
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
  // Rate limiting
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
  // Context reuse
  // -------------------------------------------------------------------------

  describe('context reuse', () => {
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

      // 1 actual page (no probe on first context creation)
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

      // 1 probe + 1 page initially, then 1 new page (context still valid, no new probe)
      expect(mockNewPage).toHaveBeenCalledTimes(3)
    })

    it('creates new context if previous context throws on newPage', async () => {
      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com',
      })

      // Simulate context dead — newPage throws (reconnect probe fails)
      mockPageIsClosed.mockReturnValue(true)
      mockNewPage
        .mockRejectedValueOnce(new Error('context closed'))
        .mockResolvedValue(createMockPage())

      // Need to re-setup after context recreation
      mockLaunchPersistentContext.mockResolvedValue(createMockContext())

      await browserTool.execute({
        action: 'openPage',
        url: 'https://example.com/new',
      })

      expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // openSession
  // -------------------------------------------------------------------------

  describe('openSession', () => {
    it('opens a non-headless persistent browser context', async () => {
      const result = await browserTool.execute({
        action: 'openSession',
        domain: 'github.com',
      })

      expect(mockLaunchPersistentContext).toHaveBeenCalledWith(
        expect.stringContaining('browser-sessions/github.com'),
        { headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
      )

      const parsed = JSON.parse(getTextContent(result)) as { sessionOpened: boolean; domain: string }
      expect(parsed.sessionOpened).toBe(true)
      expect(parsed.domain).toBe('github.com')
    })

    it('closes default context before opening session', async () => {
      // First open a default page
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(1)

      // Now open session — default context should be closed
      await browserTool.execute({ action: 'openSession', domain: 'github.com' })
      expect(mockContextClose).toHaveBeenCalled()
    })

    it('existing actions use persistent session page', async () => {
      await browserTool.execute({ action: 'openSession', domain: 'github.com' })

      // Screenshot should work using the persistent context page
      await browserTool.execute({ action: 'screenshot' })
      expect(mockScreenshot).toHaveBeenCalled()
    })

    it('closes previous session when opening a new one', async () => {
      await browserTool.execute({ action: 'openSession', domain: 'github.com' })
      await browserTool.execute({ action: 'openSession', domain: 'gitlab.com' })

      expect(mockContextClose).toHaveBeenCalled()
      expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(2)
    })

    it('rejects invalid domain with path traversal', async () => {
      await expect(
        browserTool.execute({ action: 'openSession', domain: 'foo..bar' }),
      ).rejects.toThrow('".."')
    })

    it('rejects domain with path separators', async () => {
      await expect(
        browserTool.execute({ action: 'openSession', domain: 'evil/path' }),
      ).rejects.toThrow('path separators')
    })

    it('rejects domain with whitespace', async () => {
      await expect(
        browserTool.execute({ action: 'openSession', domain: 'evil domain.com' }),
      ).rejects.toThrow('whitespace')
    })

    it('rejects empty domain', async () => {
      await expect(
        browserTool.execute({ action: 'openSession', domain: '' }),
      ).rejects.toThrow('non-empty')
    })
  })

  // -------------------------------------------------------------------------
  // closeSession
  // -------------------------------------------------------------------------

  describe('closeSession', () => {
    it('closes persistent context and allows new default context', async () => {
      await browserTool.execute({ action: 'openSession', domain: 'github.com' })
      const result = await browserTool.execute({ action: 'closeSession', domain: 'github.com' })

      expect(mockContextClose).toHaveBeenCalled()
      const parsed = JSON.parse(getTextContent(result)) as { sessionClosed: boolean }
      expect(parsed.sessionClosed).toBe(true)

      // Next action should launch a new persistent context (default profile)
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(2)
    })

    it('throws when no session is active', async () => {
      await expect(
        browserTool.execute({ action: 'closeSession', domain: 'github.com' }),
      ).rejects.toThrow('No active browser session')
    })

    it('throws when domain does not match active session', async () => {
      await browserTool.execute({ action: 'openSession', domain: 'github.com' })

      await expect(
        browserTool.execute({ action: 'closeSession', domain: 'gitlab.com' }),
      ).rejects.toThrow('Active session is for "github.com"')
    })
  })

  // -------------------------------------------------------------------------
  // session timer
  // -------------------------------------------------------------------------

  describe('session timer', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('auto-closes session after 10 minutes', async () => {
      await browserTool.execute({ action: 'openSession', domain: 'github.com' })

      // Advance 10 minutes
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

      expect(mockContextClose).toHaveBeenCalled()

      // Next action should launch new persistent context
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(2)
    })

    it('timer is cancelled by closeSession', async () => {
      await browserTool.execute({ action: 'openSession', domain: 'github.com' })
      await browserTool.execute({ action: 'closeSession', domain: 'github.com' })

      // Advance past timeout — should not error or call close again
      mockContextClose.mockClear()
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

      expect(mockContextClose).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // fillCredential
  // -------------------------------------------------------------------------

  describe('fillCredential', () => {
    it('calls resolver and fills credential', async () => {
      const mockResolver = { resolve: vi.fn().mockResolvedValue('s3cret') }
      setCredentialResolver(mockResolver)

      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      const result = await browserTool.execute({ action: 'fillCredential', selector: '#password' })

      expect(mockResolver.resolve).toHaveBeenCalledWith('https://example.com/')
      expect(mockFill).toHaveBeenCalledWith('#password', 's3cret', { timeout: 30_000 })

      const parsed = JSON.parse(getTextContent(result)) as Record<string, unknown>
      expect(parsed).toEqual({ filled: true, selector: '#password' })

      setCredentialResolver(null as unknown as import('../src/browser').CredentialResolver)
    })

    it('throws without resolver', async () => {
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })

      await expect(
        browserTool.execute({ action: 'fillCredential', selector: '#password' }),
      ).rejects.toThrow('Kein CredentialResolver registriert')
    })

    it('does not leak credential value in result', async () => {
      const mockResolver = { resolve: vi.fn().mockResolvedValue('super-secret-pw') }
      setCredentialResolver(mockResolver)

      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      const result = await browserTool.execute({ action: 'fillCredential', selector: '#pw' })
      const text = getTextContent(result)
      const parsed = JSON.parse(text) as Record<string, unknown>

      expect(Object.keys(parsed)).toEqual(['filled', 'selector'])
      expect(text).not.toContain('super-secret-pw')

      setCredentialResolver(null as unknown as import('../src/browser').CredentialResolver)
    })
  })

  // -------------------------------------------------------------------------
  // healthCheck
  // -------------------------------------------------------------------------

  describe('healthCheck', () => {
    it('reports unhealthy when no context exists', async () => {
      const result = await browserTool.execute({ action: 'healthCheck' })
      const parsed = JSON.parse(getTextContent(result)) as { healthy: boolean; url: unknown; title: unknown }

      expect(parsed.healthy).toBe(false)
      expect(parsed.url).toBeNull()
      expect(parsed.title).toBeNull()
    })

    it('reports healthy after openPage', async () => {
      mockTitle.mockResolvedValue('Example Page')
      mockUrl.mockReturnValue('https://example.com/')

      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      const result = await browserTool.execute({ action: 'healthCheck' })
      const parsed = JSON.parse(getTextContent(result)) as { healthy: boolean; url: string; title: string }

      expect(parsed.healthy).toBe(true)
      expect(parsed.url).toBe('https://example.com/')
      expect(parsed.title).toBe('Example Page')
    })
  })

  // -------------------------------------------------------------------------
  // getCurrentPageUrl
  // -------------------------------------------------------------------------

  describe('getCurrentPageUrl', () => {
    it('returns null when no page is open', () => {
      expect(getCurrentPageUrl()).toBeNull()
    })

    it('returns URL after openPage', async () => {
      mockUrl.mockReturnValue('https://example.com/')
      await browserTool.execute({ action: 'openPage', url: 'https://example.com' })
      expect(getCurrentPageUrl()).toBe('https://example.com/')
    })
  })

  // -------------------------------------------------------------------------
  // domain validation
  // -------------------------------------------------------------------------

  describe('validateDomain', () => {
    it('accepts valid domains', () => {
      expect(validateDomain('github.com')).toBe('github.com')
      expect(validateDomain('accounts.google.com')).toBe('accounts.google.com')
      expect(validateDomain('my-service.example.io')).toBe('my-service.example.io')
    })

    it('trims whitespace', () => {
      expect(validateDomain('  github.com  ')).toBe('github.com')
    })

    it('rejects path separators', () => {
      expect(() => validateDomain('evil/path')).toThrow('path separators')
      expect(() => validateDomain('evil\\path')).toThrow('path separators')
    })

    it('rejects path traversal', () => {
      expect(() => validateDomain('..')).toThrow('".."')
      expect(() => validateDomain('foo..bar')).toThrow('".."')
    })

    it('rejects path traversal with separators', () => {
      expect(() => validateDomain('../etc')).toThrow('path separators')
    })

    it('rejects whitespace in domain', () => {
      expect(() => validateDomain('evil domain.com')).toThrow('whitespace')
    })

    it('rejects empty string', () => {
      expect(() => validateDomain('')).toThrow('empty')
      expect(() => validateDomain('   ')).toThrow('empty')
    })

    it('rejects invalid patterns', () => {
      expect(() => validateDomain('noextension')).toThrow('Invalid domain')
      expect(() => validateDomain('.leading-dot.com')).toThrow('Invalid domain')
    })
  })

  // -------------------------------------------------------------------------
  // parseArgs — session actions
  // -------------------------------------------------------------------------

  describe('parseArgs — session actions', () => {
    it('parses openSession args', () => {
      const result = parseArgs({ action: 'openSession', domain: 'github.com' })
      expect(result).toEqual({ action: 'openSession', domain: 'github.com' })
    })

    it('parses closeSession args', () => {
      const result = parseArgs({ action: 'closeSession', domain: 'github.com' })
      expect(result).toEqual({ action: 'closeSession', domain: 'github.com' })
    })

    it('rejects openSession without domain', () => {
      expect(() => parseArgs({ action: 'openSession' })).toThrow('domain')
    })

    it('rejects closeSession without domain', () => {
      expect(() => parseArgs({ action: 'closeSession' })).toThrow('domain')
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

  it('has domain validation for sessions', () => {
    expect(sourceCode).toContain('validateDomain')
    expect(sourceCode).toContain('DOMAIN_PATTERN')
  })

  it('has session timeout', () => {
    expect(sourceCode).toContain('SESSION_TIMEOUT_MS')
  })

  it('blocks path traversal in domain', () => {
    expect(sourceCode).toContain('path separators')
    expect(sourceCode).toContain('".."')
  })

  it('does not use page.evaluate for DOM mutation', () => {
    expect(sourceCode).toContain('page.evaluate is intentionally not used')
  })

  it('has credential resolver security comment', () => {
    expect(sourceCode).toContain('Credentials flow via fillCredential + CredentialResolver only')
  })
})

// ---------------------------------------------------------------------------
// Headless configuration
// ---------------------------------------------------------------------------

describe('headless configuration', () => {
  beforeEach(async () => {
    await closeBrowser()
    _resetRateLimit()
    setupDefaultMocks()
  })

  afterEach(async () => {
    await closeBrowser()
  })

  it('openPage launches with headless: true', async () => {
    setPlaywrightLoader(async () => ({
      chromium: { launchPersistentContext: mockLaunchPersistentContext },
    }))

    await browserTool.execute({ action: 'openPage', url: 'https://example.com' })

    expect(mockLaunchPersistentContext).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headless: true }),
    )
  })

  it('openSession launches with headless: false', async () => {
    setPlaywrightLoader(async () => ({
      chromium: { launchPersistentContext: mockLaunchPersistentContext },
    }))

    await browserTool.execute({ action: 'openSession', domain: 'github.com' })

    expect(mockLaunchPersistentContext).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headless: false }),
    )
  })
})
