import { afterEach, describe, expect, it } from 'vitest'
import type { ExtendedAgentTool } from '../src/types'
import { _resetRegistry, registerTool } from '../src/index'
import { bridgeToOpenClaw, createOpenClawCodingTools } from '../src/register'

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

describe('createOpenClawCodingTools', () => {
  afterEach(() => {
    _resetRegistry()
  })

  it('returns empty array when no tools registered', () => {
    const tools = createOpenClawCodingTools()
    expect(tools).toEqual([])
  })

  it('returns bridged tools for all registered tools', () => {
    registerTool(makeTool({ name: 'tool-a' }))
    registerTool(makeTool({ name: 'tool-b' }))
    const tools = createOpenClawCodingTools()
    expect(tools).toHaveLength(2)
    expect(tools.map((t) => t.name)).toEqual(['tool-a', 'tool-b'])
  })
})

describe('bridgeToOpenClaw', () => {
  it('preserves name, description, and parameters', () => {
    const original = makeTool({
      name: 'my-tool',
      description: 'My description',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
    })
    const bridged = bridgeToOpenClaw(original)
    expect(bridged.name).toBe('my-tool')
    expect(bridged.description).toBe('My description')
    expect(bridged.parameters).toEqual(original.parameters)
  })

  it('adapts execute signature from (args) to (toolCallId, params, signal)', async () => {
    const original = makeTool({
      execute: async (args) => ({
        content: [{ type: 'text', text: JSON.stringify(args) }],
      }),
    })
    const bridged = bridgeToOpenClaw(original)
    const result = await bridged.execute('call-123', { query: 'test' })
    expect(result.content[0]).toEqual({
      type: 'text',
      text: '{"query":"test"}',
    })
  })

  it('passes params through to the original execute', async () => {
    const params = { path: '/tmp', recursive: true }
    let receivedArgs: unknown
    const original = makeTool({
      execute: async (args) => {
        receivedArgs = args
        return { content: [{ type: 'text', text: 'done' }] }
      },
    })
    const bridged = bridgeToOpenClaw(original)
    await bridged.execute('call-456', params)
    expect(receivedArgs).toEqual(params)
  })

  it('strips permissions but preserves requiresConfirmation and runsOn', () => {
    const original = makeTool({
      permissions: ['fs.read', 'fs.write'],
      requiresConfirmation: true,
      runsOn: 'desktop',
    })
    const bridged = bridgeToOpenClaw(original)
    expect(bridged).not.toHaveProperty('permissions')
    expect(bridged.runsOn).toBe('desktop')
    expect(bridged.requiresConfirmation).toBe(true)
  })

  it('preserves runsOn: server', () => {
    const original = makeTool({ runsOn: 'server' })
    const bridged = bridgeToOpenClaw(original)
    expect(bridged.runsOn).toBe('server')
  })

  it('accepts optional AbortSignal parameter', async () => {
    const original = makeTool()
    const bridged = bridgeToOpenClaw(original)
    const controller = new AbortController()
    const result = await bridged.execute('call-789', {}, controller.signal)
    expect(result.content[0]).toEqual({ type: 'text', text: 'ok' })
  })
})
