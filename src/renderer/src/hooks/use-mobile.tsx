import { useSyncExternalStore } from 'react'

const query = '(max-width: 767px)'

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(query)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}
