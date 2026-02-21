export default function Toast({
  message,
  type = 'success',
  show,
}: {
  readonly message: string
  readonly type?: 'success' | 'error'
  readonly show: boolean
}): JSX.Element | null {
  if (!show) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`animate-fade-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-md ${
        type === 'error'
          ? 'border-error/50 bg-surface-raised text-error'
          : 'border-edge bg-surface-raised text-content-secondary'
      }`}
    >
      {message}
    </div>
  )
}
