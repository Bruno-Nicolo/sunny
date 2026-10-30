import { useLayoutEffect, useRef, useState } from 'react'

/** Removes middle folders to fit, preferring the last two complete folder names. */
function shortenDirectoryPath(path: string, fits: (value: string) => boolean): string {
  if (fits(path)) return path
  const parts = path.split('/').filter(Boolean)
  const root = path.startsWith('/') ? '/' : ''
  for (const tail of [2, 1]) {
    const suffix = parts.slice(-tail).join('/')
    for (let head = parts.length - tail - 1; head >= 1; head--) {
      const candidate = `${root}${parts.slice(0, head).join('/')}/…/${suffix}`
      if (fits(candidate)) return candidate
    }
    if (parts.length > tail) {
      const candidate = `…/${suffix}`
      if (fits(candidate)) return candidate
    }
  }
  return parts.length > 1 ? `…/${parts.at(-1)}` : path
}

export function DirectoryPath({ path }: { path: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [label, setLabel] = useState(path)

  useLayoutEffect(() => {
    const element = ref.current!
    const context = document.createElement('canvas').getContext('2d')!
    const measure = (): void => {
      context.font = getComputedStyle(element).font
      element.style.width = `${Math.ceil(context.measureText(path).width)}px`
      const width = element.clientWidth
      setLabel(shortenDirectoryPath(path, (value) => context.measureText(value).width <= width))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    document.fonts.addEventListener('loadingdone', measure)
    return () => {
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', measure)
    }
  }, [path])

  return (
    <div
      ref={ref}
      className="max-w-[min(24rem,calc(100vw-3.5rem))] break-words text-muted-foreground"
      aria-label={path}
    >
      {label}
    </div>
  )
}
