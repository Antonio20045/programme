/**
 * OpenClaw bridge — adapts ExtendedAgentTool to OpenClaw's tool interface.
 */

import type { AgentToolResult } from './types'
import { getAllTools } from './index'
import type { ExtendedAgentTool } from './types'

export interface OpenClawTool {
  readonly name: string
  readonly description: string
  readonly parameters: ExtendedAgentTool['parameters']
  readonly execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult>
}

export function bridgeToOpenClaw(tool: ExtendedAgentTool): OpenClawTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult> => {
      return tool.execute(params)
    },
  }
}

export function createOpenClawCodingTools(): OpenClawTool[] {
  const tools = getAllTools()
  const result: OpenClawTool[] = []
  for (const tool of tools.values()) {
    result.push(bridgeToOpenClaw(tool))
  }
  return result
}
