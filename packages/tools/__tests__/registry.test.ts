import { afterEach, describe, expect, it } from 'vitest'
import type { ExtendedAgentTool } from '../src/types'
import {
  ToolRegistrationError,
  _resetRegistry,
  getAllTools,
  getTool,
  registerTool,
} from '../src/index'

function makeTool(overrides: Partial<ExtendedAgentTool> = {}): ExtendedAgentTool {
  return {
    name: 'test-tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    permissions: [],
    requiresConfirmation: false,
    runsOn: 'server',
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    ...overrides,
  }
}

describe('registerTool', () => {
  afterEach(() => {
    _resetRegistry()
  })

  it('registers a valid tool', () => {
    const tool = makeTool()
    registerTool(tool)
    expect(getTool('test-tool')).toBe(tool)
  })

  it('accepts names with lowercase, digits, hyphens, underscores', () => {
    registerTool(makeTool({ name: 'web-search' }))
    registerTool(makeTool({ name: 'file_read' }))
    registerTool(makeTool({ name: 'tool123' }))
    expect(getAllTools().size).toBe(3)
  })

  it('rejects names starting with a digit', () => {
    expect(() => registerTool(makeTool({ name: '1tool' }))).toThrow(ToolRegistrationError)
  })

  it('rejects names starting with a hyphen', () => {
    expect(() => registerTool(makeTool({ name: '-tool' }))).toThrow(ToolRegistrationError)
  })

  it('rejects names with uppercase letters', () => {
    expect(() => registerTool(makeTool({ name: 'MyTool' }))).toThrow(ToolRegistrationError)
  })

  it('rejects empty name', () => {
    expect(() => registerTool(makeTool({ name: '' }))).toThrow(ToolRegistrationError)
  })

  it('rejects names longer than 64 characters', () => {
    const longName = 'a' + 'b'.repeat(64)
    expect(() => registerTool(makeTool({ name: longName }))).toThrow(ToolRegistrationError)
  })

  it('rejects names with special characters', () => {
    expect(() => registerTool(makeTool({ name: 'tool.name' }))).toThrow(ToolRegistrationError)
    expect(() => registerTool(makeTool({ name: 'tool name' }))).toThrow(ToolRegistrationError)
  })

  it('rejects duplicate tool names', () => {
    registerTool(makeTool({ name: 'my-tool' }))
    expect(() => registerTool(makeTool({ name: 'my-tool' }))).toThrow(
      'already registered',
    )
  })

  it('rejects empty description', () => {
    expect(() => registerTool(makeTool({ description: '' }))).toThrow(ToolRegistrationError)
  })

  it('rejects whitespace-only description', () => {
    expect(() => registerTool(makeTool({ description: '   ' }))).toThrow(ToolRegistrationError)
  })

  it('rejects parameters.type not equal to object', () => {
    const tool = makeTool({
      parameters: { type: 'array' as never, properties: {} },
    })
    expect(() => registerTool(tool)).toThrow(ToolRegistrationError)
  })

  it('rejects invalid runsOn value', () => {
    const tool = makeTool({ runsOn: 'cloud' as never })
    expect(() => registerTool(tool)).toThrow(ToolRegistrationError)
  })

  it('rejects non-function execute', () => {
    const tool = makeTool({ execute: 'not-a-function' as never })
    expect(() => registerTool(tool)).toThrow(ToolRegistrationError)
  })

  it('throws ToolRegistrationError (not generic Error)', () => {
    expect(() => registerTool(makeTool({ name: '' }))).toThrow(ToolRegistrationError)
  })
})

describe('getTool', () => {
  afterEach(() => {
    _resetRegistry()
  })

  it('returns the registered tool by name', () => {
    const tool = makeTool({ name: 'find-me' })
    registerTool(tool)
    expect(getTool('find-me')).toBe(tool)
  })

  it('returns undefined for unregistered name', () => {
    expect(getTool('nonexistent')).toBeUndefined()
  })
})

describe('getAllTools', () => {
  afterEach(() => {
    _resetRegistry()
  })

  it('returns empty map when no tools registered', () => {
    expect(getAllTools().size).toBe(0)
  })

  it('returns all registered tools', () => {
    registerTool(makeTool({ name: 'tool-a' }))
    registerTool(makeTool({ name: 'tool-b' }))
    registerTool(makeTool({ name: 'tool-c' }))
    const all = getAllTools()
    expect(all.size).toBe(3)
    expect(all.has('tool-a')).toBe(true)
    expect(all.has('tool-b')).toBe(true)
    expect(all.has('tool-c')).toBe(true)
  })

  it('returns a ReadonlyMap', () => {
    const all = getAllTools()
    expect(typeof all.get).toBe('function')
    expect(typeof all.has).toBe('function')
    expect(typeof all.size).toBe('number')
  })
})

describe('_resetRegistry', () => {
  it('clears all registered tools', () => {
    registerTool(makeTool({ name: 'tool-x' }))
    expect(getAllTools().size).toBe(1)
    _resetRegistry()
    expect(getAllTools().size).toBe(0)
  })
})
