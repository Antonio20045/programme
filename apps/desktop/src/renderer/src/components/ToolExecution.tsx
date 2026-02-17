import { useState, useCallback } from 'react'

interface ToolExecutionProps {
  readonly toolName: string
  readonly params: Record<string, unknown>
  readonly result?: unknown
  readonly startedAt: number
  readonly finishedAt?: number
}

function formatDuration(startedAt: number, finishedAt: number): string {
  const ms = finishedAt - startedAt
  if (ms < 1000) return `${ms.toString()}ms`
  const seconds = (ms / 1000).toFixed(1)
  return `${seconds}s`
}

function truncateResult(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}…`
}

function formatParams(params: Record<string, unknown>): string {
  return JSON.stringify(params, null, 2)
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

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  return (
    <div className="my-1 rounded-lg border border-gray-700 bg-gray-800/50">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-700/50"
      >
        <span
          className={`inline-block text-xs transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        >
          ▶
        </span>

        <span className="font-medium text-gray-200">{toolName}</span>

        {isRunning ? (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-amber-400">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
            läuft…
          </span>
        ) : (
          <span className="ml-auto text-xs text-gray-500">
            abgeschlossen ({formatDuration(startedAt, finishedAt)})
          </span>
        )}
      </button>

      <div
        className={`overflow-hidden transition-all duration-200 ${expanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="border-t border-gray-700 px-3 py-2 text-xs">
          <div className="mb-2">
            <span className="font-medium text-gray-400">Parameter</span>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-gray-900 px-2 py-1.5 text-gray-300">
              {formatParams(params)}
            </pre>
          </div>

          {result !== undefined && (
            <div>
              <span className="font-medium text-gray-400">Ergebnis</span>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-gray-900 px-2 py-1.5 text-gray-300">
                {truncateResult(result, 500)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { formatDuration, truncateResult, formatParams }
export type { ToolExecutionProps }
