/**
 * Shared date/time formatting utilities.
 * Single source of truth for all German-locale date formatting in the renderer.
 */

/** Relative time for session list (heute 14:30, Gestern, vor 3 Tagen, 01.02.25) */
export function formatRelativeDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays === 1) return 'Gestern'
  if (diffDays < 7) return `vor ${diffDays.toString()} Tagen`
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** Relative time for settings/activity (vor 2 Min., vor 1 Std., Gestern, etc.) */
export function relativeTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHrs = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMin < 1) return 'gerade eben'
  if (diffMin < 60) return `vor ${diffMin.toString()} Min.`
  if (diffHrs < 24) return `vor ${diffHrs.toString()} Std.`
  if (diffDays === 1) return 'Gestern'
  if (diffDays < 7) return `vor ${diffDays.toString()} Tagen`
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Full German date for display (21. Februar 2026, 14:30) */
export function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Short date (21.02.2026) */
export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Duration formatting (e.g. "350ms", "1.2s") */
export function formatDuration(startedAt: number, finishedAt: number): string {
  const ms = finishedAt - startedAt
  if (ms < 1000) return `${ms.toString()}ms`
  const seconds = (ms / 1000).toFixed(1)
  return `${seconds}s`
}

/** Group label for time-based session grouping */
export function getTimeGroup(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffDays === 0) return 'Heute'
  if (diffDays === 1) return 'Gestern'
  if (diffDays < 7) return 'Diese Woche'
  if (diffDays < 30) return 'Diesen Monat'
  return 'Älter'
}
