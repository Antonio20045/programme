import { useState, useCallback } from 'react'
import { formatDuration } from '../utils/format-date'

interface ToolExecutionProps {
  readonly toolName: string
  readonly params: Record<string, unknown>
  readonly result?: unknown
  readonly startedAt: number
  readonly finishedAt?: number
}

/** Map tool names to descriptive icons */
const TOOL_ICONS = new Map<string, string>([
  ['web-search', '\u{1F50D}'],
  ['filesystem', '\u{1F4C1}'],
  ['shell', '\u{1F4BB}'],
  ['browser', '\u{1F310}'],
  ['gmail', '\u{2709}\uFE0F'],
  ['calendar', '\u{1F4C5}'],
  ['reminders', '\u{23F0}'],
  ['notes', '\u{1F4DD}'],
  ['calculator', '\u{1F522}'],
  ['clipboard', '\u{1F4CB}'],
  ['screenshot', '\u{1F4F7}'],
  ['image-gen', '\u{1F3A8}'],
  ['git-tools', '\u{1F500}'],
  ['code-runner', '\u{25B6}\uFE0F'],
  ['translator', '\u{1F30D}'],
  ['weather', '\u{2600}\uFE0F'],
  ['http-client', '\u{1F4E1}'],
])

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
  const isRunning = finishedAt === undefined
  const icon = TOOL_ICONS.get(toolName) ?? '\u{1F527}'
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
          className={`h-3 w-3 shrink-0 text-content-muted transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
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
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            läuft…
          </span>
        ) : (
          <span className="ml-auto shrink-0 text-xs text-content-muted">
            abgeschlossen ({formatDuration(startedAt, finishedAt)})
          </span>
        )}
      </button>

      <div
        className={`overflow-hidden transition-all duration-200 ${expanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}
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
      </div>
    </div>
  )
}

export { truncateResult, formatParams, summarizeParams, TOOL_ICONS }
export type { ToolExecutionProps }
