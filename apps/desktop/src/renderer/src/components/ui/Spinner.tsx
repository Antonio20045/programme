/** Shared spinner component. Replaces duplicated SpinnerSmall in Settings and DevicePairing. */
export default function Spinner({
  size = 'sm',
}: {
  readonly size?: 'sm' | 'md' | 'lg'
}): JSX.Element {
  const sizeClass = size === 'sm' ? 'h-4 w-4' : size === 'md' ? 'h-6 w-6' : 'h-8 w-8'

  return (
    <svg className={`${sizeClass} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
