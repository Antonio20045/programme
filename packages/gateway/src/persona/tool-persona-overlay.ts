/**
 * Applies persona-friendly descriptions to ExtendedAgentTool arrays.
 *
 * Creates shallow copies with replaced descriptions.
 * Tool names, execute functions, and parameter structure stay unchanged.
 */

import type { ExtendedAgentTool, JSONSchema, JSONSchemaProperty } from '../../../tools/src/types.js'
import { getToolPersona } from './tool-descriptions.js'

/**
 * Apply persona overlays to a list of tools.
 * Returns new array with shallow-copied tools — originals are never mutated.
 */
export function applyToolPersonas(
  tools: readonly ExtendedAgentTool[],
): ExtendedAgentTool[] {
  return tools.map((tool) => {
    const persona = getToolPersona(tool.name)

    // Build new parameters with overridden descriptions (if any)
    let parameters: JSONSchema = tool.parameters
    if (persona.paramOverrides) {
      const newProps: Record<string, JSONSchemaProperty> = {}
      for (const [key, prop] of Object.entries(tool.parameters.properties)) {
        const override = persona.paramOverrides[key]
        if (override) {
          newProps[key] = { ...prop, description: override }
        } else {
          newProps[key] = prop
        }
      }
      parameters = { ...tool.parameters, properties: newProps }
    }

    return {
      ...tool,
      description: persona.description,
      parameters,
    }
  })
}
