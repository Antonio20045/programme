/**
 * Screenshot tool — capture screen or window screenshots.
 * Uses a Factory pattern with Dependency Injection: the Electron
 * desktopCapturer API is injected via an adapter.
 *
 * Security:
 * - requiresConfirmation: true (screenshots can show sensitive content)
 * - No network access, no eval
 * - Returns ImageContent for LLM vision processing
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

export interface ScreenshotResult {
  readonly data: string      // base64 PNG
  readonly mimeType: string
  readonly width: number
  readonly height: number
}

export interface ScreenshotAdapter {
  readonly captureScreen: () => Promise<ScreenshotResult>
  readonly captureWindow: (windowTitle?: string) => Promise<ScreenshotResult>
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CaptureScreenArgs {
  readonly action: 'captureScreen'
}

interface CaptureWindowArgs {
  readonly action: 'captureWindow'
  readonly windowTitle?: string
}

type ScreenshotArgs = CaptureScreenArgs | CaptureWindowArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_WIDTH = 1920

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): ScreenshotArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'captureScreen') {
    return { action: 'captureScreen' }
  }

  if (action === 'captureWindow') {
    const windowTitle = obj['windowTitle']
    if (windowTitle !== undefined && typeof windowTitle !== 'string') {
      throw new Error('windowTitle must be a string')
    }
    return {
      action: 'captureWindow',
      windowTitle: typeof windowTitle === 'string' ? windowTitle : undefined,
    }
  }

  throw new Error('action must be "captureScreen" or "captureWindow"')
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createScreenshotTool(adapter: ScreenshotAdapter): ExtendedAgentTool {
  const parameters: JSONSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: "captureScreen" for full screen, "captureWindow" for a specific window',
        enum: ['captureScreen', 'captureWindow'],
      },
      windowTitle: {
        type: 'string',
        description: 'Window title to capture (optional, for "captureWindow" action). If omitted, captures the focused window.',
      },
    },
    required: ['action'],
  }

  return {
    name: 'screenshot',
    description:
      'Capture screenshots. Actions: captureScreen() captures the full screen; captureWindow(windowTitle?) captures a specific window. Always requires user confirmation.',
    parameters,
    permissions: ['screen:capture'],
    requiresConfirmation: true,
    runsOn: 'desktop',
    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      switch (parsed.action) {
        case 'captureScreen': {
          const result = await adapter.captureScreen()
          return {
            content: [{
              type: 'image',
              data: result.data,
              mimeType: result.mimeType,
            }],
          }
        }
        case 'captureWindow': {
          const result = await adapter.captureWindow(parsed.windowTitle)
          return {
            content: [{
              type: 'image',
              data: result.data,
              mimeType: result.mimeType,
            }],
          }
        }
      }
    },
  }
}

export { createScreenshotTool, parseArgs, MAX_WIDTH }
