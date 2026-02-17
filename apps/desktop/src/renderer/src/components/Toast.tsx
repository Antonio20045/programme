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
      className={
        'fixed bottom-8 left-1/2 -translate-x-1/2 animate-fade-in rounded-lg border px-6 py-3 text-sm shadow-lg ' +
        (type === 'error'
          ? 'border-red-700 bg-gray-800 text-red-300'
          : 'border-gray-700 bg-gray-800 text-gray-300')
      }
    >
      {message}
    </div>
  )
}
