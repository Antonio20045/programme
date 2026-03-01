/**
 * Diagram tool — generate Mermaid diagram syntax.
 * Supports flowchart, sequence, gantt, and raw mermaid input.
 * Pure string manipulation — no network, no file I/O.
 *
 * No external dependencies.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MermaidArgs {
  readonly action: 'mermaid'
  readonly syntax: string
}

interface FlowchartNode {
  readonly id: string
  readonly label: string
}

interface FlowchartEdge {
  readonly from: string
  readonly to: string
  readonly label?: string
}

interface FlowchartArgs {
  readonly action: 'flowchart'
  readonly nodes: readonly FlowchartNode[]
  readonly edges: readonly FlowchartEdge[]
  readonly direction?: 'TD' | 'LR' | 'BT' | 'RL'
}

interface SequenceMessage {
  readonly from: string
  readonly to: string
  readonly text: string
  readonly type?: 'solid' | 'dashed' | 'solidArrow' | 'dashedArrow'
}

interface SequenceArgs {
  readonly action: 'sequence'
  readonly actors: readonly string[]
  readonly messages: readonly SequenceMessage[]
}

interface GanttTask {
  readonly name: string
  readonly start: string
  readonly duration: string
}

interface GanttSection {
  readonly name: string
  readonly tasks: readonly GanttTask[]
}

interface GanttArgs {
  readonly action: 'gantt'
  readonly title: string
  readonly sections: readonly GanttSection[]
}

interface ValidateArgs {
  readonly action: 'validate'
  readonly syntax: string
}

type DiagramArgs = MermaidArgs | FlowchartArgs | SequenceArgs | GanttArgs | ValidateArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SYNTAX_LENGTH = 50_000

const KNOWN_DIAGRAM_TYPES: ReadonlySet<string> = new Set([
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
  'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitgraph',
  'journey', 'mindmap', 'timeline', 'quadrantChart',
  'sankey', 'xychart', 'block',
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escapes special characters in Mermaid labels to prevent XSS
 * and syntax-breaking characters.
 */
function escapeLabel(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Validates Mermaid syntax with basic structural checks.
 * Returns an array of error messages (empty = valid).
 */
function validateMermaidSyntax(syntax: string): string[] {
  const errors: string[] = []
  const trimmed = syntax.trim()

  if (trimmed === '') {
    errors.push('Empty diagram syntax')
    return errors
  }

  if (trimmed.length > MAX_SYNTAX_LENGTH) {
    errors.push(`Syntax too long (${String(trimmed.length)} chars, max ${String(MAX_SYNTAX_LENGTH)})`)
    return errors
  }

  // Check first line for known diagram type
  const firstLine = trimmed.split('\n')[0]?.trim() ?? ''
  const firstWord = firstLine.split(/[\s-]/)[0] ?? ''
  if (!KNOWN_DIAGRAM_TYPES.has(firstWord)) {
    errors.push(`Unknown diagram type: "${firstWord}". Known types: ${[...KNOWN_DIAGRAM_TYPES].join(', ')}`)
  }

  // Check balanced brackets/parentheses
  const openParens = (trimmed.match(/\(/g) ?? []).length
  const closeParens = (trimmed.match(/\)/g) ?? []).length
  if (openParens !== closeParens) {
    errors.push(`Unbalanced parentheses: ${String(openParens)} opening, ${String(closeParens)} closing`)
  }

  const openBrackets = (trimmed.match(/\[/g) ?? []).length
  const closeBrackets = (trimmed.match(/\]/g) ?? []).length
  if (openBrackets !== closeBrackets) {
    errors.push(`Unbalanced brackets: ${String(openBrackets)} opening, ${String(closeBrackets)} closing`)
  }

  const openBraces = (trimmed.match(/\{/g) ?? []).length
  const closeBraces = (trimmed.match(/\}/g) ?? []).length
  if (openBraces !== closeBraces) {
    errors.push(`Unbalanced braces: ${String(openBraces)} opening, ${String(closeBraces)} closing`)
  }

  return errors
}

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function requireString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key]
  if (typeof val !== 'string' || val.trim() === '') {
    throw new Error(`${key} is required and must be a non-empty string`)
  }
  return val.trim()
}

function parseArgs(args: unknown): DiagramArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'mermaid') {
    const syntax = requireString(obj, 'syntax')
    if (syntax.length > MAX_SYNTAX_LENGTH) {
      throw new Error(`Syntax too long (max ${String(MAX_SYNTAX_LENGTH)} characters)`)
    }
    return { action: 'mermaid', syntax }
  }

  if (action === 'flowchart') {
    const nodes = obj['nodes']
    const edges = obj['edges']
    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw new Error('flowchart requires a non-empty "nodes" array')
    }
    if (!Array.isArray(edges)) {
      throw new Error('flowchart requires an "edges" array')
    }
    const direction = obj['direction']
    if (direction !== undefined && direction !== 'TD' && direction !== 'LR' && direction !== 'BT' && direction !== 'RL') {
      throw new Error('flowchart direction must be "TD", "LR", "BT", or "RL"')
    }
    // Validate node structure
    for (const node of nodes) {
      if (typeof node !== 'object' || node === null) throw new Error('Each node must be an object')
      const n = node as Record<string, unknown>
      if (typeof n['id'] !== 'string' || (n['id'] as string).trim() === '') throw new Error('Each node must have a non-empty "id"')
      if (typeof n['label'] !== 'string') throw new Error('Each node must have a "label" string')
    }
    // Validate edge structure
    for (const edge of edges) {
      if (typeof edge !== 'object' || edge === null) throw new Error('Each edge must be an object')
      const e = edge as Record<string, unknown>
      if (typeof e['from'] !== 'string' || (e['from'] as string).trim() === '') throw new Error('Each edge must have a non-empty "from"')
      if (typeof e['to'] !== 'string' || (e['to'] as string).trim() === '') throw new Error('Each edge must have a non-empty "to"')
    }
    return {
      action: 'flowchart',
      nodes: nodes as FlowchartNode[],
      edges: edges as FlowchartEdge[],
      direction: (direction as FlowchartArgs['direction']) ?? 'TD',
    }
  }

  if (action === 'sequence') {
    const actors = obj['actors']
    const messages = obj['messages']
    if (!Array.isArray(actors) || actors.length === 0) {
      throw new Error('sequence requires a non-empty "actors" array')
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('sequence requires a non-empty "messages" array')
    }
    for (const actor of actors) {
      if (typeof actor !== 'string' || actor.trim() === '') throw new Error('Each actor must be a non-empty string')
    }
    for (const msg of messages) {
      if (typeof msg !== 'object' || msg === null) throw new Error('Each message must be an object')
      const m = msg as Record<string, unknown>
      if (typeof m['from'] !== 'string') throw new Error('Each message must have a "from" string')
      if (typeof m['to'] !== 'string') throw new Error('Each message must have a "to" string')
      if (typeof m['text'] !== 'string') throw new Error('Each message must have a "text" string')
    }
    return {
      action: 'sequence',
      actors: actors as string[],
      messages: messages as SequenceMessage[],
    }
  }

  if (action === 'gantt') {
    const title = requireString(obj, 'title')
    const sections = obj['sections']
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new Error('gantt requires a non-empty "sections" array')
    }
    for (const section of sections) {
      if (typeof section !== 'object' || section === null) throw new Error('Each section must be an object')
      const s = section as Record<string, unknown>
      if (typeof s['name'] !== 'string') throw new Error('Each section must have a "name" string')
      if (!Array.isArray(s['tasks'])) throw new Error('Each section must have a "tasks" array')
      for (const task of s['tasks'] as unknown[]) {
        if (typeof task !== 'object' || task === null) throw new Error('Each task must be an object')
        const t = task as Record<string, unknown>
        if (typeof t['name'] !== 'string') throw new Error('Each task must have a "name" string')
        if (typeof t['start'] !== 'string') throw new Error('Each task must have a "start" string')
        if (typeof t['duration'] !== 'string') throw new Error('Each task must have a "duration" string')
      }
    }
    return {
      action: 'gantt',
      title,
      sections: sections as GanttSection[],
    }
  }

  if (action === 'validate') {
    const syntax = requireString(obj, 'syntax')
    return { action: 'validate', syntax }
  }

  throw new Error('action must be "mermaid", "flowchart", "sequence", "gantt", or "validate"')
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function executeMermaid(syntax: string): AgentToolResult {
  const errors = validateMermaidSyntax(syntax)
  const block = '```mermaid\n' + syntax.trim() + '\n```'

  if (errors.length > 0) {
    return textResult(JSON.stringify({ diagram: block, warnings: errors }))
  }
  return textResult(JSON.stringify({ diagram: block }))
}

function executeFlowchart(nodes: readonly FlowchartNode[], edges: readonly FlowchartEdge[], direction: string): AgentToolResult {
  const lines: string[] = [`flowchart ${direction}`]

  for (const node of nodes) {
    lines.push(`  ${node.id}[${escapeLabel(node.label)}]`)
  }

  for (const edge of edges) {
    if (edge.label) {
      lines.push(`  ${edge.from} -->|${escapeLabel(edge.label)}| ${edge.to}`)
    } else {
      lines.push(`  ${edge.from} --> ${edge.to}`)
    }
  }

  const syntax = lines.join('\n')
  const block = '```mermaid\n' + syntax + '\n```'
  return textResult(JSON.stringify({ diagram: block, syntax }))
}

function executeSequence(actors: readonly string[], messages: readonly SequenceMessage[]): AgentToolResult {
  const lines: string[] = ['sequenceDiagram']

  for (const actor of actors) {
    lines.push(`  participant ${escapeLabel(actor)}`)
  }

  const arrowMap: Readonly<Record<string, string>> = {
    solid: '->>',
    dashed: '-->>',
    solidArrow: '->>',
    dashedArrow: '-->>',
  }

  for (const msg of messages) {
    const arrow = arrowMap[msg.type ?? 'solid'] ?? '->>'
    lines.push(`  ${escapeLabel(msg.from)}${arrow}${escapeLabel(msg.to)}: ${escapeLabel(msg.text)}`)
  }

  const syntax = lines.join('\n')
  const block = '```mermaid\n' + syntax + '\n```'
  return textResult(JSON.stringify({ diagram: block, syntax }))
}

function executeGantt(title: string, sections: readonly GanttSection[]): AgentToolResult {
  const lines: string[] = ['gantt', `  title ${escapeLabel(title)}`, '  dateFormat YYYY-MM-DD']

  for (const section of sections) {
    lines.push(`  section ${escapeLabel(section.name)}`)
    for (const task of section.tasks) {
      lines.push(`    ${escapeLabel(task.name)} :${task.start}, ${task.duration}`)
    }
  }

  const syntax = lines.join('\n')
  const block = '```mermaid\n' + syntax + '\n```'
  return textResult(JSON.stringify({ diagram: block, syntax }))
}

function executeValidate(syntax: string): AgentToolResult {
  const errors = validateMermaidSyntax(syntax)
  return textResult(JSON.stringify({ valid: errors.length === 0, errors }))
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "mermaid", "flowchart", "sequence", "gantt", or "validate"',
      enum: ['mermaid', 'flowchart', 'sequence', 'gantt', 'validate'],
    },
    syntax: {
      type: 'string',
      description: 'Raw Mermaid syntax (mermaid, validate)',
    },
    nodes: {
      type: 'array',
      description: 'Flowchart nodes: [{id, label}]',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Node identifier' },
          label: { type: 'string', description: 'Node display label' },
        },
        required: ['id', 'label'],
      },
    },
    edges: {
      type: 'array',
      description: 'Flowchart edges: [{from, to, label?}]',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Source node id' },
          to: { type: 'string', description: 'Target node id' },
          label: { type: 'string', description: 'Edge label (optional)' },
        },
        required: ['from', 'to'],
      },
    },
    direction: {
      type: 'string',
      description: 'Flowchart direction: TD (top-down), LR (left-right), BT, RL',
      enum: ['TD', 'LR', 'BT', 'RL'],
    },
    actors: {
      type: 'array',
      description: 'Sequence diagram actors (strings)',
      items: { type: 'string' },
    },
    messages: {
      type: 'array',
      description: 'Sequence messages: [{from, to, text, type?}]',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          text: { type: 'string' },
          type: { type: 'string', enum: ['solid', 'dashed', 'solidArrow', 'dashedArrow'] },
        },
        required: ['from', 'to', 'text'],
      },
    },
    title: {
      type: 'string',
      description: 'Gantt chart title',
    },
    sections: {
      type: 'array',
      description: 'Gantt sections: [{name, tasks: [{name, start, duration}]}]',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                start: { type: 'string' },
                duration: { type: 'string' },
              },
              required: ['name', 'start', 'duration'],
            },
          },
        },
        required: ['name', 'tasks'],
      },
    },
  },
  required: ['action'],
}

export const diagramTool: ExtendedAgentTool = {
  name: 'diagram',
  description:
    'Generate Mermaid diagram syntax. Actions: mermaid(syntax) wraps raw syntax in a code block; flowchart(nodes, edges, direction?) generates a flowchart; sequence(actors, messages) generates a sequence diagram; gantt(title, sections) generates a Gantt chart; validate(syntax) checks syntax validity.',
  parameters,
  permissions: [],
  requiresConfirmation: false,
  defaultRiskTier: 0,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'mermaid':
        return executeMermaid(parsed.syntax)
      case 'flowchart':
        return executeFlowchart(parsed.nodes, parsed.edges, parsed.direction ?? 'TD')
      case 'sequence':
        return executeSequence(parsed.actors, parsed.messages)
      case 'gantt':
        return executeGantt(parsed.title, parsed.sections)
      case 'validate':
        return executeValidate(parsed.syntax)
    }
  },
}

export { escapeLabel, parseArgs, validateMermaidSyntax }
