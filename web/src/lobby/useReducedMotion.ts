/**
 * Whether this visitor has asked for reduced motion, kept live.
 *
 * The preference can change while the page is open — a visitor who turns it on
 * mid-tour should not have to reload to be taken seriously.
 */
import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function current(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(QUERY).matches
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(current)

  useEffect(() => {
    if (!window.matchMedia) return
    const media = window.matchMedia(QUERY)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    media.addEventListener('change', onChange)
    setReduced(media.matches)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return reduced
}
