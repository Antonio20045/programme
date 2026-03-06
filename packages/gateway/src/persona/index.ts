/**
 * Persona Abstraction Layer — barrel export.
 */

export { containsTechnicalTerms } from './blocklist.js'
export { getToolPersona, buildToolDescriptionHints } from './tool-descriptions.js'
export type { ToolPersona } from './tool-descriptions.js'
export { applyToolPersonas } from './tool-persona-overlay.js'
export { transformError } from './error-transformer.js'
export { sanitizePromptText } from './prompt-sanitizer.js'
export { monitorOutput } from './output-monitor.js'
export { sanitizeOutputText } from './output-sanitizer.js'
