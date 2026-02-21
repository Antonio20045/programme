import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { diagramTool, escapeLabel, parseArgs, validateMermaidSyntax } from '../src/diagram'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/diagram.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: { content: readonly { type: string; text?: string }[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('diagram tool', () => {
  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(diagramTool.name).toBe('diagram')
    })

    it('runs on server', () => {
      expect(diagramTool.runsOn).toBe('server')
    })

    it('has no permissions', () => {
      expect(diagramTool.permissions).toEqual([])
    })

    it('does not require confirmation', () => {
      expect(diagramTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // mermaid()
  // -------------------------------------------------------------------------

  describe('mermaid()', () => {
    it('wraps syntax in code block', async () => {
      const result = await diagramTool.execute({
        action: 'mermaid',
        syntax: 'graph TD\n  A --> B',
      })
      const parsed = parseResult(result)
      expect(parsed['diagram']).toContain('```mermaid')
      expect(parsed['diagram']).toContain('graph TD')
      expect(parsed['diagram']).toContain('A --> B')
    })

    it('returns warnings for unknown diagram type', async () => {
      const result = await diagramTool.execute({
        action: 'mermaid',
        syntax: 'unknownType\n  A --> B',
      })
      const parsed = parseResult(result)
      expect(parsed['warnings']).toBeDefined()
    })

    it('rejects empty syntax', async () => {
      await expect(
        diagramTool.execute({ action: 'mermaid', syntax: '' }),
      ).rejects.toThrow('non-empty')
    })

    it('rejects syntax exceeding max length', async () => {
      const longSyntax = 'x'.repeat(50_001)
      await expect(
        diagramTool.execute({ action: 'mermaid', syntax: longSyntax }),
      ).rejects.toThrow('too long')
    })
  })

  // -------------------------------------------------------------------------
  // flowchart()
  // -------------------------------------------------------------------------

  describe('flowchart()', () => {
    it('generates a basic flowchart', async () => {
      const result = await diagramTool.execute({
        action: 'flowchart',
        nodes: [
          { id: 'A', label: 'Start' },
          { id: 'B', label: 'End' },
        ],
        edges: [{ from: 'A', to: 'B' }],
      })
      const parsed = parseResult(result)
      const syntax = parsed['syntax'] as string
      expect(syntax).toContain('flowchart TD')
      expect(syntax).toContain('A[Start]')
      expect(syntax).toContain('B[End]')
      expect(syntax).toContain('A --> B')
    })

    it('supports custom direction', async () => {
      const result = await diagramTool.execute({
        action: 'flowchart',
        nodes: [{ id: 'A', label: 'Node' }],
        edges: [],
        direction: 'LR',
      })
      const parsed = parseResult(result)
      expect(parsed['syntax']).toContain('flowchart LR')
    })

    it('supports edge labels', async () => {
      const result = await diagramTool.execute({
        action: 'flowchart',
        nodes: [
          { id: 'A', label: 'Start' },
          { id: 'B', label: 'End' },
        ],
        edges: [{ from: 'A', to: 'B', label: 'next' }],
      })
      const parsed = parseResult(result)
      expect(parsed['syntax']).toContain('-->|next|')
    })

    it('escapes labels', async () => {
      const result = await diagramTool.execute({
        action: 'flowchart',
        nodes: [{ id: 'A', label: 'A & B <script>' }],
        edges: [],
      })
      const parsed = parseResult(result)
      const syntax = parsed['syntax'] as string
      expect(syntax).toContain('&amp;')
      expect(syntax).toContain('&lt;')
      expect(syntax).toContain('&gt;')
      expect(syntax).not.toContain('<script>')
    })

    it('rejects empty nodes', async () => {
      await expect(
        diagramTool.execute({ action: 'flowchart', nodes: [], edges: [] }),
      ).rejects.toThrow('non-empty "nodes"')
    })

    it('rejects invalid direction', async () => {
      await expect(
        diagramTool.execute({
          action: 'flowchart',
          nodes: [{ id: 'A', label: 'A' }],
          edges: [],
          direction: 'XX',
        }),
      ).rejects.toThrow('direction must be')
    })
  })

  // -------------------------------------------------------------------------
  // sequence()
  // -------------------------------------------------------------------------

  describe('sequence()', () => {
    it('generates a sequence diagram', async () => {
      const result = await diagramTool.execute({
        action: 'sequence',
        actors: ['Client', 'Server'],
        messages: [
          { from: 'Client', to: 'Server', text: 'Request' },
          { from: 'Server', to: 'Client', text: 'Response' },
        ],
      })
      const parsed = parseResult(result)
      const syntax = parsed['syntax'] as string
      expect(syntax).toContain('sequenceDiagram')
      expect(syntax).toContain('participant Client')
      expect(syntax).toContain('participant Server')
      expect(syntax).toContain('Client->>Server: Request')
      expect(syntax).toContain('Server->>Client: Response')
    })

    it('supports dashed messages', async () => {
      const result = await diagramTool.execute({
        action: 'sequence',
        actors: ['A', 'B'],
        messages: [{ from: 'A', to: 'B', text: 'Async', type: 'dashed' }],
      })
      const parsed = parseResult(result)
      expect(parsed['syntax']).toContain('-->>B')
    })

    it('escapes actor names and message text', async () => {
      const result = await diagramTool.execute({
        action: 'sequence',
        actors: ['A<br>'],
        messages: [{ from: 'A<br>', to: 'A<br>', text: 'x"y' }],
      })
      const parsed = parseResult(result)
      const syntax = parsed['syntax'] as string
      expect(syntax).not.toContain('<br>')
      expect(syntax).toContain('&lt;br&gt;')
    })

    it('rejects empty actors', async () => {
      await expect(
        diagramTool.execute({
          action: 'sequence',
          actors: [],
          messages: [{ from: 'A', to: 'B', text: 'msg' }],
        }),
      ).rejects.toThrow('non-empty "actors"')
    })

    it('rejects empty messages', async () => {
      await expect(
        diagramTool.execute({ action: 'sequence', actors: ['A'], messages: [] }),
      ).rejects.toThrow('non-empty "messages"')
    })
  })

  // -------------------------------------------------------------------------
  // gantt()
  // -------------------------------------------------------------------------

  describe('gantt()', () => {
    it('generates a gantt chart', async () => {
      const result = await diagramTool.execute({
        action: 'gantt',
        title: 'Project Plan',
        sections: [
          {
            name: 'Phase 1',
            tasks: [
              { name: 'Design', start: '2024-01-01', duration: '7d' },
              { name: 'Build', start: '2024-01-08', duration: '14d' },
            ],
          },
        ],
      })
      const parsed = parseResult(result)
      const syntax = parsed['syntax'] as string
      expect(syntax).toContain('gantt')
      expect(syntax).toContain('title Project Plan')
      expect(syntax).toContain('section Phase 1')
      expect(syntax).toContain('Design :2024-01-01, 7d')
      expect(syntax).toContain('Build :2024-01-08, 14d')
    })

    it('supports multiple sections', async () => {
      const result = await diagramTool.execute({
        action: 'gantt',
        title: 'Multi-Section',
        sections: [
          { name: 'A', tasks: [{ name: 'Task A', start: '2024-01-01', duration: '3d' }] },
          { name: 'B', tasks: [{ name: 'Task B', start: '2024-01-04', duration: '5d' }] },
        ],
      })
      const parsed = parseResult(result)
      const syntax = parsed['syntax'] as string
      expect(syntax).toContain('section A')
      expect(syntax).toContain('section B')
    })

    it('escapes title and names', async () => {
      const result = await diagramTool.execute({
        action: 'gantt',
        title: 'Plan & <Goals>',
        sections: [
          { name: 'Phase "1"', tasks: [{ name: 'Task <1>', start: '2024-01-01', duration: '1d' }] },
        ],
      })
      const parsed = parseResult(result)
      const syntax = parsed['syntax'] as string
      expect(syntax).toContain('&amp;')
      expect(syntax).toContain('&lt;Goals&gt;')
      expect(syntax).toContain('&quot;1&quot;')
    })

    it('rejects empty title', async () => {
      await expect(
        diagramTool.execute({
          action: 'gantt',
          title: '',
          sections: [{ name: 'S', tasks: [] }],
        }),
      ).rejects.toThrow('non-empty')
    })

    it('rejects empty sections', async () => {
      await expect(
        diagramTool.execute({ action: 'gantt', title: 'T', sections: [] }),
      ).rejects.toThrow('non-empty "sections"')
    })
  })

  // -------------------------------------------------------------------------
  // validate()
  // -------------------------------------------------------------------------

  describe('validate()', () => {
    it('validates correct syntax', async () => {
      const result = await diagramTool.execute({
        action: 'validate',
        syntax: 'graph TD\n  A[Start] --> B[End]',
      })
      const parsed = parseResult(result)
      expect(parsed['valid']).toBe(true)
      expect(parsed['errors']).toEqual([])
    })

    it('detects unknown diagram type', async () => {
      const result = await diagramTool.execute({
        action: 'validate',
        syntax: 'badType\n  A --> B',
      })
      const parsed = parseResult(result)
      expect(parsed['valid']).toBe(false)
      expect((parsed['errors'] as string[])[0]).toContain('Unknown diagram type')
    })

    it('detects unbalanced brackets', async () => {
      const result = await diagramTool.execute({
        action: 'validate',
        syntax: 'graph TD\n  A[Start --> B',
      })
      const parsed = parseResult(result)
      expect(parsed['valid']).toBe(false)
      expect((parsed['errors'] as string[]).some((e) => e.includes('bracket'))).toBe(true)
    })

    it('rejects empty syntax', async () => {
      await expect(
        diagramTool.execute({ action: 'validate', syntax: '' }),
      ).rejects.toThrow('non-empty')
    })

    it('detects unbalanced parentheses', async () => {
      const result = await diagramTool.execute({
        action: 'validate',
        syntax: 'graph TD\n  A(Start --> B',
      })
      const parsed = parseResult(result)
      expect(parsed['valid']).toBe(false)
      expect((parsed['errors'] as string[]).some((e) => e.includes('parenthes'))).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(diagramTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(diagramTool.execute(42)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        diagramTool.execute({ action: 'hack' }),
      ).rejects.toThrow('action must be')
    })
  })

  // -------------------------------------------------------------------------
  // Exported helpers
  // -------------------------------------------------------------------------

  describe('escapeLabel()', () => {
    it('escapes ampersand', () => {
      expect(escapeLabel('A & B')).toBe('A &amp; B')
    })

    it('escapes angle brackets', () => {
      expect(escapeLabel('<script>')).toBe('&lt;script&gt;')
    })

    it('escapes quotes', () => {
      expect(escapeLabel('"hello"')).toBe('&quot;hello&quot;')
    })

    it('escapes single quotes', () => {
      expect(escapeLabel("it's")).toBe('it&#39;s')
    })

    it('handles plain text', () => {
      expect(escapeLabel('Hello World')).toBe('Hello World')
    })
  })

  describe('validateMermaidSyntax()', () => {
    it('returns empty for valid syntax', () => {
      expect(validateMermaidSyntax('flowchart TD\n  A --> B')).toEqual([])
    })

    it('returns error for empty input', () => {
      expect(validateMermaidSyntax('')).toContainEqual('Empty diagram syntax')
    })

    it('returns error for unknown type', () => {
      const errors = validateMermaidSyntax('unknown\n  A --> B')
      expect(errors.some((e) => e.includes('Unknown diagram type'))).toBe(true)
    })
  })

  describe('parseArgs()', () => {
    it('parses mermaid action', () => {
      const result = parseArgs({ action: 'mermaid', syntax: 'graph TD' })
      expect(result).toEqual({ action: 'mermaid', syntax: 'graph TD' })
    })
  })

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [])
    })

    it('has no network access', () => {
      const fetchPattern = /\bfetch\s*\(/
      expect(sourceCode).not.toMatch(fetchPattern)
    })

    it('has no file I/O', () => {
      expect(sourceCode).not.toContain("from 'node:fs")
    })

    it('enforces syntax length limit', () => {
      expect(sourceCode).toContain('MAX_SYNTAX_LENGTH')
    })

    describe('XSS prevention via label escaping', () => {
      it('escapes script tags in flowchart labels', async () => {
        const result = await diagramTool.execute({
          action: 'flowchart',
          nodes: [{ id: 'A', label: '<script>alert(1)</script>' }],
          edges: [],
        })
        const parsed = parseResult(result)
        const syntax = parsed['syntax'] as string
        expect(syntax).not.toContain('<script>')
        expect(syntax).toContain('&lt;script&gt;')
      })

      it('escapes img onerror in sequence messages', async () => {
        const result = await diagramTool.execute({
          action: 'sequence',
          actors: ['A', 'B'],
          messages: [{ from: 'A', to: 'B', text: '<img onerror="alert(1)">' }],
        })
        const parsed = parseResult(result)
        const syntax = parsed['syntax'] as string
        expect(syntax).not.toContain('<img')
        expect(syntax).toContain('&lt;img')
      })

      it('escapes event handlers in gantt titles', async () => {
        const result = await diagramTool.execute({
          action: 'gantt',
          title: '<div onmouseover="alert(1)">',
          sections: [{ name: 'S', tasks: [{ name: 'T', start: '2024-01-01', duration: '1d' }] }],
        })
        const parsed = parseResult(result)
        const syntax = parsed['syntax'] as string
        expect(syntax).not.toContain('<div')
        expect(syntax).toContain('&lt;div')
      })
    })
  })
})
