import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDuration } from '../utils/format-date'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { expandVariants, expandTransition, staticVariants } from '../utils/motion'
import { TOOL_ICONS, TOOL_ICON_FALLBACK } from '../utils/tool-icons'
import { cn } from '../utils/cn'

interface ToolExecutionProps {
  readonly toolName: string
  readonly params: Record<string, unknown>
  readonly result?: unknown
  readonly startedAt: number
  readonly finishedAt?: number
}

function truncateResult(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\u2026`
}

function formatParams(params: Record<string, unknown>): string {
  return JSON.stringify(params, null, 2)
}

/** Compact one-line summary of params (e.g. "query: 'wetter morgen'") */
function summarizeParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params)
  if (entries.length === 0) return ''
  const parts = entries.slice(0, 2).map(([key, val]) => {
    const str = typeof val === 'string' ? val : JSON.stringify(val)
    const truncated = str.length > 40 ? `${str.slice(0, 40)}\u2026` : str
    return `${key}: ${truncated}`
  })
  if (entries.length > 2) parts.push('\u2026')
  return parts.join(', ')
}

export default function ToolExecution({
  toolName,
  params,
  result,
  startedAt,
  finishedAt,
}: ToolExecutionProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const reduced = useReducedMotion()
  const isRunning = finishedAt === undefined
  const icon = TOOL_ICONS.get(toolName) ?? TOOL_ICON_FALLBACK
  const summary = summarizeParams(params)

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  return (
    <div className="my-1 rounded-lg border border-edge bg-surface-raised/50">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-hover/50"
      >
        {/* Chevron */}
        <svg
          className={cn(
            'h-3 w-3 shrink-0 text-content-muted transition-transform duration-200',
            expanded && 'rotate-90',
          )}
          viewBox="0 0 12 12"
          fill="currentColor"
        >
          <path d="M4.5 2l4 4-4 4V2z" />
        </svg>

        {/* Tool icon + name */}
        <span className="shrink-0 text-sm" aria-hidden="true">{icon}</span>
        <span className="font-medium text-content">{toolName}</span>

        {/* Compact param summary */}
        {summary.length > 0 && (
          <span className="hidden truncate text-xs text-content-muted sm:inline">{summary}</span>
        )}

        {/* Status */}
        {isRunning ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-accent">
            <motion.svg
              className="h-3 w-3 text-accent"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              animate={reduced ? undefined : { rotate: 360 }}
              transition={reduced ? undefined : { repeat: Infinity, duration: 0.8, ease: 'linear' }}
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </motion.svg>
            läuft…
          </span>
        ) : (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-content-muted">
            <motion.span
              className="text-success"
              initial={reduced ? undefined : { scale: 0, opacity: 0 }}
              animate={reduced ? undefined : { scale: 1, opacity: 1 }}
              transition={reduced ? undefined : { type: 'spring', stiffness: 500, damping: 25 }}
            >
              {'\u2713'}
            </motion.span>
            abgeschlossen ({formatDuration(startedAt, finishedAt)})
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="tool-detail"
            variants={reduced ? staticVariants : expandVariants}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            transition={expandTransition}
          >
            <div className="border-t border-edge px-3 py-2 text-xs">
              <div className="mb-2">
                <span className="font-medium text-content-secondary">Parameter</span>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-surface px-2 py-1.5 text-content-secondary">
                  {formatParams(params)}
                </pre>
              </div>

              {result !== undefined && (
                <div>
                  <span className="font-medium text-content-secondary">Ergebnis</span>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-surface px-2 py-1.5 text-content-secondary">
                    {truncateResult(result, 500)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export { truncateResult, formatParams, summarizeParams, TOOL_ICONS }
export type { ToolExecutionProps }
