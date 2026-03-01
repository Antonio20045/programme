/**
 * Orchestrator Classifier — rule-based message classification for sub-agent routing.
 *
 * Called in gateway middleware BEFORE the LLM call. No LLM invocation —
 * pure heuristics + agent registry lookup.
 *
 * Determines: complexity, matching agents, model tier, parallel execution.
 */

import { getActiveAgents } from './agent-registry'
import { trackRequest } from './pattern-tracker'
import type { AgentDefinition } from './agent-registry'
import type { DbPool } from './types'

// ---------------------------------------------------------------------------
// Mirrored from packages/gateway/src/model-router.ts (lines 32-80) — keep in sync
// ---------------------------------------------------------------------------

/** Sequential connectors (EN + DE). */
const SEQUENTIAL_PATTERN =
  /\b(?:and\s+then|then\s+also|after\s+that|finally|first\s+.{1,40}\s+then|und\s+dann|danach|anschlie[sß]end|zuerst\s+.{1,40}\s+dann|au[sß]erdem\s+.{1,40}\s+und)\b/i

/** Analysis / summary keywords (EN + DE). */
const ANALYSIS_PATTERN =
  /\b(?:analy[sz](?:e|iere|ieren)|zusammenfass(?:en|ung)|summary|summarize|summarise|erkl[aä]r(?:e|en|ung)\s+(?:ausf[uü]hrlich|im\s+detail|genau)|explain\s+in\s+detail|ausf[uü]hrlich\s+(?:erkl[aä]r|beschreib|erl[aä]uter)|comprehensive|compare\s+and\s+contrast|vergleich(?:e|en)\s+.{1,30}\s+(?:mit|und)|pros?\s+(?:and|und)\s+cons?|vor-?\s*(?:und|and)\s*nachteile|bewert(?:e|en|ung)|deep\s*dive|write\s+(?:a\s+)?(?:report|essay|article|bericht|aufsatz)|draft\s+(?:a\s+)?(?:report|document|bericht))\b/i

/** Coding / technical task keywords (EN + DE). */
const CODING_PATTERN =
  /\b(?:refactor(?:e|en|ing)?|debug(?:ge|ging)?|implementier(?:e|en)|implement(?:ing)?|fix\s+(?:the|this|a|den|diesen)\s+bug|bugfix|write\s+(?:a\s+)?(?:function|class|module|component|test|hook)|schreib\s+(?:eine?n?\s+)?(?:funktion|klasse|modul|komponente|test)|code\s*review|pull\s+request|merge\s+conflict|typescript|javascript|python|regex|algorithm|datenstruktur|data\s*structure|api\s+(?:design|endpoint)|schema\s+(?:design|migration)|migration|optimier(?:e|en|ung)|optimize|unit\s*test(?:s|en)?)\b/i

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Complexity = 'trivial' | 'simple' | 'moderate' | 'complex'
type ModelTier = 'haiku' | 'sonnet' | 'opus'

interface ClassificationResult {
  readonly complexity: Complexity
  readonly category: string
  readonly matchedAgents: readonly string[]
  readonly modelTier: ModelTier
  readonly parallelExecution: boolean
}

// ---------------------------------------------------------------------------
// Trivial detection
// ---------------------------------------------------------------------------

const MAX_TRIVIAL_LENGTH = 30
const MAX_MESSAGE_LENGTH = 50_000

const TRIVIAL_PATTERN =
  /^(?:h(?:i|allo|ey)|hello|guten\s+(?:morgen|tag|abend)|moin|servus|danke(?:sch[oö]n)?|thanks?|thx|vielen\s+dank|ja|nein|yes|no|ok(?:ay)?|klar|genau|jo|n[oö]|nope|yep|alles\s+klar|passt|super|gut|cool|nice)$/i

function isTrivial(message: string): boolean {
  const trimmed = message.trim()
  return trimmed.length <= MAX_TRIVIAL_LENGTH && TRIVIAL_PATTERN.test(trimmed)
}

// ---------------------------------------------------------------------------
// Mirrored heuristic functions (from model-router.ts — keep in sync)
// ---------------------------------------------------------------------------

function hasMultipleSubTasks(message: string): boolean {
  if (SEQUENTIAL_PATTERN.test(message)) return true

  const numberedItems = message.match(/(?:^|\n)\s*\d+[.)]\s/g)
  if (numberedItems && numberedItems.length >= 2) return true

  const bulletItems = message.match(/(?:^|\n)\s*[-*]\s/g)
  if (bulletItems && bulletItems.length >= 3) return true

  return false
}

function requestsAnalysis(message: string): boolean {
  return ANALYSIS_PATTERN.test(message)
}

function isCodingTask(message: string): boolean {
  return CODING_PATTERN.test(message)
}

function requiresMultiToolCoordination(
  toolCount: number,
  hasMultiStep: boolean,
): boolean {
  return toolCount >= 2 && hasMultiStep
}

// ---------------------------------------------------------------------------
// Agent keyword matching
// ---------------------------------------------------------------------------

const STOP_WORDS: ReadonlySet<string> = new Set([
  // DE
  'der', 'die', 'das', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen',
  'und', 'oder', 'aber', 'auch', 'noch', 'schon', 'sehr', 'mehr',
  'nicht', 'kein', 'keine', 'keinem', 'keinen', 'keiner',
  'mit', 'von', 'aus', 'bei', 'nach', 'vor', 'seit', 'bis',
  'den', 'dem', 'des', 'sich', 'wird', 'sind', 'hat', 'ist',
  'alle', 'alle', 'kann', 'soll', 'muss', 'will', 'darf',
  'hier', 'dort', 'dann', 'wenn', 'weil', 'dass', 'wie',
  'was', 'wer', 'wen', 'wem', 'welch',
  'sein', 'haben', 'werden', 'sein',
  // EN
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all',
  'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has',
  'his', 'how', 'its', 'let', 'may', 'new', 'now', 'old',
  'see', 'way', 'who', 'did', 'get', 'got', 'him', 'she',
  'too', 'use', 'that', 'this', 'with', 'have', 'from',
  'they', 'been', 'said', 'each', 'which', 'their',
  'will', 'other', 'about', 'many', 'then', 'them',
  'these', 'some', 'would', 'make', 'like', 'into',
  'could', 'time', 'very', 'when', 'come', 'made',
  'after', 'back', 'only', 'just', 'also',
])

const MIN_KEYWORD_LENGTH = 4

function extractKeywords(text: string): string[] {
  return text
    .split(/[^a-zäöüß-]+/i)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(w))
}

function matchAgents(
  message: string,
  agents: readonly AgentDefinition[],
): string[] {
  const lowerMessage = message.toLowerCase()
  const matched: string[] = []

  for (const agent of agents) {
    const keywords = extractKeywords(`${agent.name} ${agent.description}`)
    const hasMatch = keywords.some((kw) => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`\\b${escaped}\\b`, 'i').test(lowerMessage)
    })
    if (hasMatch) {
      matched.push(agent.id)
    }
  }

  return matched
}

// ---------------------------------------------------------------------------
// Complexity + model tier
// ---------------------------------------------------------------------------

function countCriteria(
  message: string,
  matchedAgentIds: readonly string[],
  agents: readonly AgentDefinition[],
): number {
  let count = 0

  if (hasMultipleSubTasks(message)) count++
  if (requestsAnalysis(message)) count++
  if (isCodingTask(message)) count++

  // Adapted requiresMultiToolCoordination: use matched agents' tool count
  const matchedSet = new Set(matchedAgentIds)
  const uniqueTools = new Set<string>()
  for (const agent of agents) {
    if (matchedSet.has(agent.id)) {
      for (const tool of agent.tools) {
        uniqueTools.add(tool)
      }
    }
  }
  const hasMultiStep = SEQUENTIAL_PATTERN.test(message)
  if (requiresMultiToolCoordination(uniqueTools.size, hasMultiStep)) count++

  return count
}

function determineComplexity(
  matchCount: number,
  criteriaCount: number,
): { complexity: Complexity; parallelExecution: boolean } {
  if (matchCount >= 2) {
    return { complexity: 'complex', parallelExecution: true }
  }
  if (matchCount === 1) {
    return { complexity: 'simple', parallelExecution: false }
  }
  // 0 agents
  if (criteriaCount >= 2) {
    return { complexity: 'moderate', parallelExecution: false }
  }
  return { complexity: 'simple', parallelExecution: false }
}

function determineModelTier(
  message: string,
  criteriaCount: number,
): ModelTier {
  const trimmed = message.trim()
  if (/^\/opus\b/i.test(trimmed)) return 'opus'
  if (criteriaCount >= 2) return 'sonnet'
  return 'haiku'
}

// ---------------------------------------------------------------------------
// Category derivation
// ---------------------------------------------------------------------------

function deriveCategory(
  message: string,
  matchedAgentIds: readonly string[],
  agents: readonly AgentDefinition[],
): string {
  if (matchedAgentIds.length > 0) {
    const firstAgent = agents.find((a) => a.id === matchedAgentIds[0])
    if (firstAgent) return firstAgent.name.toLowerCase()
  }
  if (isCodingTask(message)) return 'coding'
  if (requestsAnalysis(message)) return 'analysis'
  return 'general'
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

async function classify(
  message: string,
  userId: string,
  pool: DbPool,
): Promise<ClassificationResult> {
  // 0. Defense-in-depth: truncate oversized messages
  const safeMessage =
    message.length > MAX_MESSAGE_LENGTH
      ? message.slice(0, MAX_MESSAGE_LENGTH)
      : message

  // 1. Trivial — no agents, no tracking
  if (isTrivial(safeMessage)) {
    return {
      complexity: 'trivial',
      category: 'general',
      matchedAgents: [],
      modelTier: 'haiku',
      parallelExecution: false,
    }
  }

  // 2. Load active agents
  const agents = await getActiveAgents(pool, userId)

  // 3. Match agents
  const matchedAgentIds = matchAgents(safeMessage, agents)

  // 4. Count criteria
  const criteriaCount = countCriteria(safeMessage, matchedAgentIds, agents)

  // 5. Determine complexity
  const { complexity, parallelExecution } = determineComplexity(
    matchedAgentIds.length,
    criteriaCount,
  )

  // 6. Model tier
  const modelTier = determineModelTier(safeMessage, criteriaCount)

  // 7. Category
  const category = deriveCategory(safeMessage, matchedAgentIds, agents)

  // 8. Pattern tracking — fire-and-forget (use original message for tracking)
  trackRequest(pool, userId, category, safeMessage).catch(() => {})

  return {
    complexity,
    category,
    matchedAgents: matchedAgentIds,
    modelTier,
    parallelExecution,
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { classify, isTrivial, matchAgents, extractKeywords }
export type { ClassificationResult, Complexity, ModelTier }
