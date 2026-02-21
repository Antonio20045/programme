/**
 * Clipboard tool — read and write the system clipboard.
 * Uses a Factory pattern with Dependency Injection: the Electron clipboard
 * API is injected via an adapter, keeping this package Electron-free.
 *
 * Security:
 * - requiresConfirmation: true (read can expose sensitive data)
 * - Write size limited to 1 MB
 * - No network access, no eval
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

export interface ClipboardAdapter {
  readonly readText: () => Promise<string>
  readonly writeText: (text: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReadArgs {
  readonly action: 'read'
}

interface WriteArgs {
  readonly action: 'write'
  readonly text: string
}

type ClipboardArgs = ReadArgs | WriteArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_WRITE_SIZE = 1_000_000

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): ClipboardArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'read') {
    return { action: 'read' }
  }

  if (action === 'write') {
    const text = obj['text']
    if (typeof text !== 'string') {
      throw new Error('write requires a "text" string')
    }
    return { action: 'write', text }
  }

  throw new Error('action must be "read" or "write"')
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createClipboardTool(adapter: ClipboardAdapter): ExtendedAgentTool {
  const parameters: JSONSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: "read" to get clipboard content, "write" to set clipboard content',
        enum: ['read', 'write'],
      },
      text: {
        type: 'string',
        description: 'Text to write to clipboard (required for "write" action)',
      },
    },
    required: ['action'],
  }

  return {
    name: 'clipboard',
    description:
      'Read and write the system clipboard. Actions: read() returns current clipboard text; write(text) sets clipboard content. Requires user confirmation.',
    parameters,
    permissions: ['clipboard:read', 'clipboard:write'],
    requiresConfirmation: true,
    runsOn: 'desktop',
    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      switch (parsed.action) {
        case 'read': {
          const text = await adapter.readText()
          return { content: [{ type: 'text', text }] }
        }
        case 'write': {
          if (parsed.text.length > MAX_WRITE_SIZE) {
            throw new Error(`Text too large (max ${String(MAX_WRITE_SIZE)} characters)`)
          }
          await adapter.writeText(parsed.text)
          return {
            content: [{ type: 'text', text: JSON.stringify({ written: true, length: parsed.text.length }) }],
          }
        }
      }
    },
  }
}

export { createClipboardTool, parseArgs, MAX_WRITE_SIZE }
