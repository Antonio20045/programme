import { afterEach, describe, expect, it } from 'vitest'
import type { ExtendedAgentTool } from '../src/types'
import { _resetRegistry, registerTool } from '../src/index'
import { bridgeToOpenClaw, createOpenClawCodingTools, withUserTools, withDisabledTools, _resetInitialized } from '../src/register'

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
    _resetInitialized()
  })

  it('auto-initializes tools when registry is empty', () => {
    const tools = createOpenClawCodingTools()
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.map((t) => t.name)).toContain('calculator')
    expect(tools.map((t) => t.name)).toContain('weather')
    expect(tools.map((t) => t.name)).toContain('clipboard')
    expect(tools.map((t) => t.name)).toContain('screenshot')
    // New desktop tools (always registered, even without allowedDirs)
    expect(tools.map((t) => t.name)).toContain('media-control')
    expect(tools.map((t) => t.name)).toContain('git-tools')
    expect(tools.map((t) => t.name)).toContain('app-launcher')
  })

  it('returns bridged tools for manually registered tools', () => {
    registerTool(makeTool({ name: 'tool-a' }))
    registerTool(makeTool({ name: 'tool-b' }))
    const tools = createOpenClawCodingTools()
    // auto-init adds default tools + our 2 manual ones
    expect(tools.map((t) => t.name)).toContain('tool-a')
    expect(tools.map((t) => t.name)).toContain('tool-b')
  })
})

describe('withUserTools', () => {
  afterEach(() => {
    _resetRegistry()
    _resetInitialized()
  })

  it('makes user tools visible inside the callback', async () => {
    registerTool(makeTool({ name: 'global-tool' }))

    const userTool = makeTool({ name: 'user-notes' })

    await withUserTools([userTool], async () => {
      const tools = createOpenClawCodingTools()
      const names = tools.map((t) => t.name)
      expect(names).toContain('global-tool')
      expect(names).toContain('user-notes')
    })
  })

  it('user tools are NOT visible outside the callback', async () => {
    registerTool(makeTool({ name: 'global-tool' }))

    const userTool = makeTool({ name: 'user-notes' })

    await withUserTools([userTool], async () => {
      // Inside — visible
      expect(createOpenClawCodingTools().map((t) => t.name)).toContain('user-notes')
    })

    // Outside — not visible
    const toolsAfter = createOpenClawCodingTools()
    expect(toolsAfter.map((t) => t.name)).not.toContain('user-notes')
  })

  it('two parallel withUserTools calls are isolated', async () => {
    registerTool(makeTool({ name: 'shared' }))

    const toolA = makeTool({ name: 'tool-a' })
    const toolB = makeTool({ name: 'tool-b' })

    const resultA = withUserTools([toolA], async () => {
      // Small delay to ensure overlap
      await new Promise((r) => setTimeout(r, 5))
      const names = createOpenClawCodingTools().map((t) => t.name)
      expect(names).toContain('tool-a')
      expect(names).not.toContain('tool-b')
      return 'a'
    })

    const resultB = withUserTools([toolB], async () => {
      await new Promise((r) => setTimeout(r, 5))
      const names = createOpenClawCodingTools().map((t) => t.name)
      expect(names).toContain('tool-b')
      expect(names).not.toContain('tool-a')
      return 'b'
    })

    const [a, b] = await Promise.all([resultA, resultB])
    expect(a).toBe('a')
    expect(b).toBe('b')
  })

  it('without withUserTools context, no user tools appear', () => {
    registerTool(makeTool({ name: 'only-global' }))
    const tools = createOpenClawCodingTools()
    expect(tools.map((t) => t.name)).toContain('only-global')
    // Only global tools — count should match registry size
    expect(tools.length).toBe(1)
  })
})

describe('withDisabledTools', () => {
  afterEach(() => {
    _resetRegistry()
    _resetInitialized()
  })

  it('filters out disabled global tools', async () => {
    registerTool(makeTool({ name: 'shell' }))
    registerTool(makeTool({ name: 'browser' }))
    registerTool(makeTool({ name: 'calculator' }))

    await withDisabledTools(new Set(['shell', 'browser']), async () => {
      const names = createOpenClawCodingTools().map(t => t.name)
      expect(names).not.toContain('shell')
      expect(names).not.toContain('browser')
      expect(names).toContain('calculator')
    })
  })

  it('filters out disabled user tools', async () => {
    registerTool(makeTool({ name: 'calculator' }))
    const userTool = makeTool({ name: 'notes' })

    await withDisabledTools(new Set(['notes']), async () => {
      await withUserTools([userTool], async () => {
        const names = createOpenClawCodingTools().map(t => t.name)
        expect(names).not.toContain('notes')
        expect(names).toContain('calculator')
      })
    })
  })

  it('disabled tools are not filtered outside the callback', async () => {
    registerTool(makeTool({ name: 'shell' }))

    await withDisabledTools(new Set(['shell']), async () => {
      expect(createOpenClawCodingTools().map(t => t.name)).not.toContain('shell')
    })

    expect(createOpenClawCodingTools().map(t => t.name)).toContain('shell')
  })

  it('empty disabled set filters nothing', async () => {
    registerTool(makeTool({ name: 'shell' }))
    registerTool(makeTool({ name: 'browser' }))

    await withDisabledTools(new Set(), async () => {
      const names = createOpenClawCodingTools().map(t => t.name)
      expect(names).toContain('shell')
      expect(names).toContain('browser')
    })
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
