/**
 * Model Router — selects the weakest sufficient model.
 *
 * Tier hierarchy (cheapest first):
 * 1. Haiku  — default for everything
 * 2. Sonnet — only when >= 2 complexity criteria are met
 * 3. Opus   — only on explicit user override (/opus)
 */

// ─── Model IDs ──────────────────────────────────────────────

const HAIKU = "claude-haiku-4-5" as const
const SONNET = "claude-sonnet-4-5" as const
const OPUS = "claude-opus-4-6" as const

export type ModelId = typeof HAIKU | typeof SONNET | typeof OPUS

// ─── Context ────────────────────────────────────────────────

export interface SelectModelContext {
  /** Number of tools available/expected for this turn. */
  readonly toolCount: number
  /** Whether the message requires multi-step tool orchestration. */
  readonly hasMultiStep: boolean
  /** Explicit user override, e.g. "opus". */
  readonly userOverride?: string
}

// ─── Criterion Detectors ────────────────────────────────────

/** Sequential connectors (EN + DE). */
const SEQUENTIAL_PATTERN =
  /\b(?:and\s+then|then\s+also|after\s+that|finally|first\s+.{1,40}\s+then|und\s+dann|danach|anschlie[sß]end|zuerst\s+.{1,40}\s+dann|au[sß]erdem\s+.{1,40}\s+und)\b/i

/** Analysis / summary keywords (EN + DE). */
const ANALYSIS_PATTERN =
  /\b(?:analy[sz](?:e|iere|ieren)|zusammenfass(?:en|ung)|summary|summarize|summarise|erkl[aä]r(?:e|en|ung)\s+(?:ausf[uü]hrlich|im\s+detail|genau)|explain\s+in\s+detail|ausf[uü]hrlich\s+(?:erkl[aä]r|beschreib|erl[aä]uter)|comprehensive|compare\s+and\s+contrast|vergleich(?:e|en)\s+.{1,30}\s+(?:mit|und)|pros?\s+(?:and|und)\s+cons?|vor-?\s*(?:und|and)\s*nachteile|bewert(?:e|en|ung)|deep\s*dive|write\s+(?:a\s+)?(?:report|essay|article|bericht|aufsatz)|draft\s+(?:a\s+)?(?:report|document|bericht))\b/i

/** Coding / technical task keywords (EN + DE). */
const CODING_PATTERN =
  /\b(?:refactor(?:e|en|ing)?|debug(?:ge|ging)?|implementier(?:e|en)|implement(?:ing)?|fix\s+(?:the|this|a|den|diesen)\s+bug|bugfix|write\s+(?:a\s+)?(?:function|class|module|component|test|hook)|schreib\s+(?:eine?n?\s+)?(?:funktion|klasse|modul|komponente|test)|code\s*review|pull\s+request|merge\s+conflict|typescript|javascript|python|regex|algorithm|datenstruktur|data\s*structure|api\s+(?:design|endpoint)|schema\s+(?:design|migration)|migration|optimier(?:e|en|ung)|optimize|unit\s*test(?:s|en)?)\b/i

/**
 * Criterion 1: Message contains multiple sub-tasks.
 */
function hasMultipleSubTasks(message: string): boolean {
  if (SEQUENTIAL_PATTERN.test(message)) return true

  // Numbered list: "1. ... 2. ..." or "1) ... 2) ..."
  const numberedItems = message.match(/(?:^|\n)\s*\d+[.)]\s/g)
  if (numberedItems && numberedItems.length >= 2) return true

  // Bullet list with 3+ items (2 bullets could be a simple either/or)
  const bulletItems = message.match(/(?:^|\n)\s*[-*]\s/g)
  if (bulletItems && bulletItems.length >= 3) return true

  return false
}

/**
 * Criterion 2: Explicit analysis or summary requested.
 */
function requestsAnalysis(message: string): boolean {
  return ANALYSIS_PATTERN.test(message)
}

/**
 * Criterion 3: Multiple tools must be coordinated.
 * A single tool call is NOT enough — needs toolCount >= 2 AND hasMultiStep.
 */
function requiresMultiToolCoordination(context: SelectModelContext): boolean {
  return context.toolCount >= 2 && context.hasMultiStep
}

/**
 * Criterion 4: Coding/technical task with context.
 */
function isCodingTask(message: string): boolean {
  return CODING_PATTERN.test(message)
}

// ─── Multi-Step Detection ──────────────────────────────────

/**
 * Detect whether a message implies multi-step tool orchestration.
 * Pure function — no side effects, no shared state.
 */
export function detectMultiStep(
  message: string,
  recentToolNames: readonly string[],
): boolean {
  // Signal 1: Sequential connectors in message text (DE + EN)
  if (SEQUENTIAL_PATTERN.test(message)) return true

  // Signal 2: Numbered list (2+ items) → multi-step intent
  const numberedItems = message.match(/(?:^|\n)\s*\d+[.)]\s/g)
  if (numberedItems && numberedItems.length >= 2) return true

  // Signal 3: Session history shows 2+ distinct tools used recently
  const uniqueTools = new Set(recentToolNames)
  if (uniqueTools.size >= 2) return true

  return false
}

// ─── Main Export ────────────────────────────────────────────

/**
 * Select the weakest sufficient model for a message.
 *
 * - Opus: ONLY on explicit /opus override. Never automatic.
 * - Sonnet: ONLY when >= 2 of 4 criteria are met.
 * - Haiku: everything else (default).
 *
 * A single tool call is NOT a reason for Sonnet.
 * Long session history alone is NOT a reason for upgrade.
 * When in doubt, always Haiku.
 */
export function selectModel(
  message: string,
  context: SelectModelContext,
): ModelId {
  // 1. Opus — only on explicit user override
  if (context.userOverride === "opus" || context.userOverride === "/opus") {
    return OPUS
  }
  if (/^\/opus\b/i.test(message.trim())) {
    return OPUS
  }

  // 2. Count Sonnet criteria (need >= 2)
  let criteria = 0

  if (hasMultipleSubTasks(message)) criteria++
  if (requestsAnalysis(message)) criteria++
  if (requiresMultiToolCoordination(context)) criteria++
  if (isCodingTask(message)) criteria++

  if (criteria >= 2) {
    return SONNET
  }

  // 3. Default: Haiku
  return HAIKU
}
