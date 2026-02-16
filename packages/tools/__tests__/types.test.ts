import { describe, expect, it } from 'vitest'
import type {
  AgentToolResult,
  ExtendedAgentTool,
  ImageContent,
  JSONSchema,
  JSONSchemaProperty,
  TextContent,
  ToolContent,
  ToolRunsOn,
} from '../src/types'

describe('types', () => {
  it('JSONSchemaProperty supports all primitive types', () => {
    const props: JSONSchemaProperty[] = [
      { type: 'string', description: 'a string' },
      { type: 'number' },
      { type: 'integer' },
      { type: 'boolean' },
      { type: 'array', items: { type: 'string' } },
      { type: 'object', properties: { nested: { type: 'string' } } },
    ]
    expect(props).toHaveLength(6)
  })

  it('JSONSchema enforces type: object at top level', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    }
    expect(schema.type).toBe('object')
    expect(schema.properties).toBeDefined()
  })

  it('TextContent has type text and text field', () => {
    const content: TextContent = { type: 'text', text: 'hello' }
    expect(content.type).toBe('text')
    expect(content.text).toBe('hello')
  })

  it('ImageContent has type image with data and mimeType', () => {
    const content: ImageContent = {
      type: 'image',
      data: 'base64data',
      mimeType: 'image/png',
    }
    expect(content.type).toBe('image')
    expect(content.data).toBe('base64data')
    expect(content.mimeType).toBe('image/png')
  })

  it('ToolContent is a union of TextContent and ImageContent', () => {
    const items: ToolContent[] = [
      { type: 'text', text: 'result' },
      { type: 'image', data: 'abc', mimeType: 'image/jpeg' },
    ]
    expect(items).toHaveLength(2)
  })

  it('AgentToolResult wraps readonly ToolContent array', () => {
    const result: AgentToolResult = {
      content: [{ type: 'text', text: 'done' }],
    }
    expect(result.content).toHaveLength(1)
    expect(result.content[0]?.type).toBe('text')
  })

  it('ToolRunsOn is server or desktop', () => {
    const values: ToolRunsOn[] = ['server', 'desktop']
    expect(values).toContain('server')
    expect(values).toContain('desktop')
  })

  it('ExtendedAgentTool has all required fields', () => {
    const tool: ExtendedAgentTool = {
      name: 'test-tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      permissions: ['fs.read'],
      requiresConfirmation: false,
      runsOn: 'server',
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    }
    expect(tool.name).toBe('test-tool')
    expect(tool.description).toBe('A test tool')
    expect(tool.parameters.type).toBe('object')
    expect(tool.permissions).toEqual(['fs.read'])
    expect(tool.requiresConfirmation).toBe(false)
    expect(tool.runsOn).toBe('server')
    expect(typeof tool.execute).toBe('function')
  })
})
