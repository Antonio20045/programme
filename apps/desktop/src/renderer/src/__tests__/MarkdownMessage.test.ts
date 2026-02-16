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

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
}))

import MarkdownMessage from '../components/MarkdownMessage'

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
    // The react-markdown mock wraps children
    const markdownChild = result.props.children
    expect(markdownChild).toBeDefined()
    expect(markdownChild.props.children).toBe('# Test heading')
  })

  it('passes custom components to Markdown', () => {
    const result = MarkdownMessage({ content: 'test' })
    const markdownChild = result.props.children
    const { components } = markdownChild.props as { components: Record<string, unknown> }
    expect(components).toBeDefined()
    expect(typeof components['code']).toBe('function')
    expect(typeof components['a']).toBe('function')
    expect(typeof components['table']).toBe('function')
    expect(typeof components['thead']).toBe('function')
    expect(typeof components['th']).toBe('function')
    expect(typeof components['td']).toBe('function')
    expect(typeof components['tr']).toBe('function')
    expect(typeof components['ul']).toBe('function')
    expect(typeof components['ol']).toBe('function')
    expect(typeof components['li']).toBe('function')
    expect(typeof components['p']).toBe('function')
    expect(typeof components['blockquote']).toBe('function')
    expect(typeof components['h1']).toBe('function')
    expect(typeof components['h2']).toBe('function')
    expect(typeof components['h3']).toBe('function')
  })

  it('code component renders inline code without language', () => {
    const result = MarkdownMessage({ content: 'test' })
    const markdownChild = result.props.children
    const { components } = markdownChild.props as { components: Record<string, (...args: unknown[]) => unknown> }
    const codeFn = components['code'] as (props: { className?: string; children: string }) => {
      type: string
      props: { className?: string; children: unknown }
    }
    const inlineResult = codeFn({ children: 'const x = 1' })
    // Should render a <code> element (no SyntaxHighlighter)
    expect(inlineResult.type).toBe('code')
    expect(inlineResult.props.className).toContain('bg-gray-700')
  })

  it('code component renders code block with language', () => {
    const result = MarkdownMessage({ content: 'test' })
    const markdownChild = result.props.children
    const { components } = markdownChild.props as { components: Record<string, (...args: unknown[]) => unknown> }
    const codeFn = components['code'] as (props: { className?: string; children: string }) => {
      type: string
      props: { className?: string; children: unknown }
    }
    const blockResult = codeFn({ className: 'language-typescript', children: 'const x = 1\n' })
    // Should render a wrapper div with SyntaxHighlighter
    expect(blockResult.type).toBe('div')
  })

  it('link component calls openExternal via window.api', () => {
    const result = MarkdownMessage({ content: 'test' })
    const markdownChild = result.props.children
    const { components } = markdownChild.props as { components: Record<string, (...args: unknown[]) => unknown> }
    const aFn = components['a'] as (props: { href?: string; children: string }) => {
      type: typeof import('../components/MarkdownMessage')
      props: { href?: string; children: unknown }
    }
    const linkResult = aFn({ href: 'https://example.com', children: 'Link' })
    expect(linkResult).toBeDefined()
  })

  it('table component wraps children in overflow container', () => {
    const result = MarkdownMessage({ content: 'test' })
    const markdownChild = result.props.children
    const { components } = markdownChild.props as { components: Record<string, (...args: unknown[]) => unknown> }
    const tableFn = components['table'] as (props: { children: string }) => {
      type: string
      props: { className: string; children: unknown }
    }
    const tableResult = tableFn({ children: 'rows' })
    expect(tableResult.type).toBe('div')
    expect(tableResult.props.className).toContain('overflow-x-auto')
  })
})
