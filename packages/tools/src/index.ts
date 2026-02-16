/**
 * Tool registry — registers, validates, and retrieves ExtendedAgentTools.
 */

export type {
  AgentToolResult,
  ExtendedAgentTool,
  ImageContent,
  JSONSchema,
  JSONSchemaProperty,
  TextContent,
  ToolContent,
  ToolRunsOn,
} from './types'

import type { ExtendedAgentTool } from './types'

const TOOL_NAME_REGEX = /^[a-z][a-z0-9_-]{0,63}$/

const registry = new Map<string, ExtendedAgentTool>()

export class ToolRegistrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolRegistrationError'
  }
}

export function registerTool(tool: ExtendedAgentTool): void {
  if (!TOOL_NAME_REGEX.test(tool.name)) {
    throw new ToolRegistrationError(
      `Invalid tool name "${tool.name}": must match ${TOOL_NAME_REGEX.source}`,
    )
  }

  if (registry.has(tool.name)) {
    throw new ToolRegistrationError(`Tool "${tool.name}" is already registered`)
  }

  if (!tool.description || tool.description.trim() === '') {
    throw new ToolRegistrationError(`Tool "${tool.name}" must have a non-empty description`)
  }

  if (tool.parameters.type !== 'object') {
    throw new ToolRegistrationError(
      `Tool "${tool.name}" parameters.type must be "object"`,
    )
  }

  if (tool.runsOn !== 'server' && tool.runsOn !== 'desktop') {
    throw new ToolRegistrationError(
      `Tool "${tool.name}" runsOn must be "server" or "desktop"`,
    )
  }

  if (typeof tool.execute !== 'function') {
    throw new ToolRegistrationError(`Tool "${tool.name}" execute must be a function`)
  }

  registry.set(tool.name, tool)
}

export function getTool(name: string): ExtendedAgentTool | undefined {
  return registry.get(name)
}

export function getAllTools(): ReadonlyMap<string, ExtendedAgentTool> {
  return registry
}

/** Test-only: clears the registry. */
export function _resetRegistry(): void {
  registry.clear()
}
