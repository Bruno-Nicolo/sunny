import { ScrollMode, SpreadMode, type PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'

// Present one page at a time and restore the reading layout when fullscreen ends.
export function createPresentationMode(
  container: HTMLDivElement,
  viewer: PDFViewer,
  signal: AbortSignal,
  onChange: (active: boolean) => void
): () => Promise<void> {
  let previous: { scale: string; scrollMode: number; spreadMode: number } | null = null
  let lastWheel = 0
  const active = (): boolean => document.fullscreenElement === container
  const turnPage = (backwards: boolean): void => {
    if (backwards) viewer.previousPage()
    else viewer.nextPage()
  }
  document.addEventListener(
    'fullscreenchange',
    () => {
      if (active()) {
        previous = {
          scale: viewer.currentScaleValue,
          scrollMode: viewer.scrollMode,
          spreadMode: viewer.spreadMode
        }
        onChange(true)
        viewer.scrollMode = ScrollMode.PAGE
        viewer.spreadMode = SpreadMode.NONE
        viewer.currentScaleValue = 'page-fit'
        container.focus()
      } else if (previous) {
        const pageNumber = viewer.currentPageNumber
        viewer.scrollMode = previous.scrollMode
        viewer.spreadMode = previous.spreadMode
        viewer.currentScaleValue = previous.scale
        viewer.scrollPageIntoView({ pageNumber })
        previous = null
        onChange(false)
        container.focus({ preventScroll: true })
      }
    },
    { signal }
  )
  container.addEventListener(
    'keydown',
    (event) => {
      if (!active() || event.metaKey || event.ctrlKey || event.altKey) return
      const backwards = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(event.key)
      const forwards = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(event.key)
      if (!backwards && !forwards && !['Escape', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') void document.exitFullscreen()
      else if (event.key === 'Home') viewer.currentPageNumber = 1
      else if (event.key === 'End') viewer.currentPageNumber = viewer.pagesCount
      else turnPage(backwards || (event.key === ' ' && event.shiftKey))
    },
    { capture: true, signal }
  )
  container.addEventListener(
    'click',
    (event) => {
      if (!active() || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      turnPage(event.shiftKey)
    },
    { capture: true, signal }
  )
  container.addEventListener(
    'wheel',
    (event) => {
      if (!active()) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!event.deltaY || performance.now() - lastWheel < 300) return
      lastWheel = performance.now()
      turnPage(event.deltaY < 0)
    },
    { capture: true, passive: false, signal }
  )
  signal.addEventListener('abort', () => {
    if (active()) void document.exitFullscreen()
  })
  return async () => {
    if (signal.aborted || !viewer.pagesCount || active()) return
    await container.requestFullscreen()
  }
}
