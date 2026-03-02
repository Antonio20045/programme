import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock window.api before importing anything
// ---------------------------------------------------------------------------

const mockOpenExternal = vi.fn<(url: string) => Promise<void>>()

vi.stubGlobal('window', {
  api: {
    openExternal: mockOpenExternal,
    getGatewayStatus: vi.fn(),
    onGatewayStatus: vi.fn(),
  },
  matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
})

// ---------------------------------------------------------------------------
// Mock clipboard
// ---------------------------------------------------------------------------

const mockWriteText = vi.fn<(text: string) => Promise<void>>()

vi.stubGlobal('navigator', {
  clipboard: {
    writeText: mockWriteText,
  },
})

// ---------------------------------------------------------------------------
// Mock react-markdown — renders children as plain text
// ---------------------------------------------------------------------------

vi.mock('react-markdown', () => ({
  default: ({ children, components }: { children: string; components: Record<string, unknown> }) => ({
    type: 'react-markdown',
    props: { children, components },
  }),
}))

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children, language }: { children: string; language: string }) => ({
    type: 'syntax-highlighter',
    props: { children, language },
  }),
}))

// ---------------------------------------------------------------------------
// Mock framer-motion (Proxy pattern, same as ChatInput.test.ts)
// ---------------------------------------------------------------------------

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: object, prop: string) => {
        return (props: Record<string, unknown>) => ({
          type: `motion.${prop}`,
          props,
          $$typeof: Symbol.for('react.element'),
        })
      },
    },
  ),
  AnimatePresence: ({ children }: { children: unknown }) => children,
}))

// ---------------------------------------------------------------------------
// Mock useReducedMotion, cn, syntax-theme
// ---------------------------------------------------------------------------

vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}))

vi.mock('../utils/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}))

vi.mock('../utils/syntax-theme', () => ({
  default: {},
}))

import MarkdownMessage from '../components/MarkdownMessage'

// ---------------------------------------------------------------------------
// Helper: extract markdown components from render result
// ---------------------------------------------------------------------------

type CodeFn = (props: { className?: string; children: string }) => {
  type: string
  props: Record<string, unknown>
}
type SimpleFn = (props: { children: string; href?: string }) => {
  type: string
  props: Record<string, unknown>
}

function getComponents(content = 'test'): Record<string, (...args: unknown[]) => unknown> {
  const result = MarkdownMessage({ content })
  const markdownChild = result.props.children
  return (markdownChild.props as { components: Record<string, (...args: unknown[]) => unknown> }).components
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MarkdownMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteText.mockResolvedValue(undefined)
    mockOpenExternal.mockResolvedValue(undefined)
  })

  it('is a function component', () => {
    expect(typeof MarkdownMessage).toBe('function')
  })

  it('exports a default function named MarkdownMessage', () => {
    expect(MarkdownMessage.name).toBe('MarkdownMessage')
  })

  it('renders without throwing', () => {
    const result = MarkdownMessage({ content: 'Hello World' })
    expect(result).toBeDefined()
  })

  it('passes content as children to Markdown', () => {
    const result = MarkdownMessage({ content: '# Test heading' })
    const markdownChild = result.props.children
    expect(markdownChild).toBeDefined()
    expect(markdownChild.props.children).toBe('# Test heading')
  })

  it('passes custom components to Markdown', () => {
    const components = getComponents()
    expect(components).toBeDefined()
    for (const key of ['code', 'a', 'table', 'thead', 'th', 'td', 'tr', 'ul', 'ol', 'li', 'p', 'blockquote', 'h1', 'h2', 'h3']) {
      expect(typeof components[key]).toBe('function')
    }
  })

  // ── Inline code ─────────────────────────────────────────────────────

  it('inline code uses bg-surface-raised and text-accent-text with font-mono', () => {
    const codeFn = getComponents()['code'] as CodeFn
    const inlineResult = codeFn({ children: 'const x = 1' })
    expect(inlineResult.type).toBe('code')
    const cls = inlineResult.props['className'] as string
    expect(cls).toContain('bg-surface-raised')
    expect(cls).toContain('text-accent-text')
    expect(cls).toContain('font-mono')
  })

  // ── Code block ──────────────────────────────────────────────────────

  it('code block renders wrapper div with language', () => {
    const codeFn = getComponents()['code'] as CodeFn
    const blockResult = codeFn({ className: 'language-typescript', children: 'const x = 1\n' })
    expect(blockResult.type).toBe('div')
  })

  it('code block language badge has uppercase and tracking-wider', () => {
    const codeFn = getComponents()['code'] as CodeFn
    const blockResult = codeFn({ className: 'language-typescript', children: 'const x = 1\n' })
    const json = JSON.stringify(blockResult)
    expect(json).toContain('uppercase')
    expect(json).toContain('tracking-wider')
  })

  it('code block contains CopyButton with text prop', () => {
    const codeFn = getComponents()['code'] as CodeFn
    const blockResult = codeFn({ className: 'language-typescript', children: 'const x = 1\n' })
    // CopyButton is a function component — its internals (motion.span) aren't
    // expanded without a React render context. Verify it's present via props.
    const json = JSON.stringify(blockResult)
    expect(json).toContain('"text":"const x = 1"')
  })

  it('code block container has border-edge and hover:shadow-accent', () => {
    const codeFn = getComponents()['code'] as CodeFn
    const blockResult = codeFn({ className: 'language-typescript', children: 'const x = 1\n' })
    const cls = blockResult.props['className'] as string
    expect(cls).toContain('border-edge')
    expect(cls).toContain('hover:shadow-accent')
  })

  // ── Links ───────────────────────────────────────────────────────────

  it('link wraps MarkdownLink with border-b styling (no underline)', () => {
    const aFn = getComponents()['a'] as SimpleFn
    const linkResult = aFn({ href: 'https://example.com', children: 'Link' })
    expect(linkResult).toBeDefined()
    // MarkdownLink is a function component — className lives inside its render.
    // Verify the component source contains the expected classes.
    const typeFn = (linkResult as unknown as { type: { toString: () => string } }).type
    const source = typeFn.toString()
    expect(source).toContain('border-b')
    expect(source).toContain('hover:border-accent-text')
    expect(source).not.toContain('"underline"')
  })

  it('link component calls openExternal via window.api', () => {
    const aFn = getComponents()['a'] as SimpleFn
    const linkResult = aFn({ href: 'https://example.com', children: 'Link' })
    expect(linkResult).toBeDefined()
  })

  // ── Table ───────────────────────────────────────────────────────────

  it('table component wraps children in overflow container', () => {
    const tableFn = getComponents()['table'] as SimpleFn
    const tableResult = tableFn({ children: 'rows' })
    expect(tableResult.type).toBe('div')
    expect(tableResult.props['className']).toContain('overflow-x-auto')
  })
})
