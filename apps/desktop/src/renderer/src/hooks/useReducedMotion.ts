import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** Returns true when the user prefers reduced motion (OS accessibility setting). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(QUERY).matches
      : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const handler = (e: MediaQueryListEvent): void => { setReduced(e.matches) }
    mql.addEventListener('change', handler)
    return () => { mql.removeEventListener('change', handler) }
  }, [])

  return reduced
}
