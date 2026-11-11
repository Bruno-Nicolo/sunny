import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { useSortable } from '@dnd-kit/react/sortable'
import { cn } from '@/lib/utils'
import {
  paintThumbnailAnnotations,
  type ThumbnailAnnotations
} from './annotations/thumbnailAnnotations'
export type ThumbnailQueue = (render: () => Promise<void>) => Promise<void>

export const PageThumbnail = memo(function PageThumbnail({
  document,
  annotations,
  number,
  position,
  selecting,
  current,
  draggingStyle,
  gridPosition,
  disabled,
  reorderDisabled,
  selected,
  active,
  onPage,
  onReleasePage,
  enqueue
}: {
  document: PDFDocumentProxy
  annotations: ThumbnailAnnotations
  number: number
  position: number
  selecting: boolean
  current: boolean
  draggingStyle?: CSSProperties
  gridPosition?: number
  disabled: boolean
  reorderDisabled: boolean
  selected: boolean
  active: boolean
  onPage(page: number, range: boolean): void
  onReleasePage(page: PDFPageProxy): void
  enqueue: ThumbnailQueue
}): React.JSX.Element {
  const { ref, isDragSource } = useSortable({
    id: number,
    index: gridPosition ?? position,
    disabled: { draggable: reorderDisabled, droppable: reorderDisabled || !!draggingStyle },
    plugins: [],
    transition: { idle: true }
  })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const button = buttonRef.current
    const canvas = canvasRef.current
    if (!button || !canvas || !active) return
    let task: RenderTask | null = null
    let redraw: (() => void) | null = null
    let frame: number | null = null
    const base = window.document.createElement('canvas')
    base.width = base.height = 0
    let unsubscribe: (() => void) | undefined
    const scheduleRedraw = (): void => {
      if (!redraw || frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        redraw?.()
      })
    }
    const cancel = (): void => {
      unsubscribe?.()
      unsubscribe = undefined
      redraw = null
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      task?.cancel()
      task = null
    }
    let generation = 0
    let visible = false
    const render = (): void => {
      const current = ++generation
      cancel()
      canvas.width = canvas.height = base.width = base.height = 0
      if (!visible) return
      unsubscribe = annotations.subscribe(number - 1, (baseChanged) => {
        if (baseChanged) render()
        else scheduleRedraw()
      })
      void enqueue(async () => {
        if (current !== generation) return
        await new Promise<void>((resolve) => requestIdleCallback(() => resolve(), { timeout: 100 }))
        if (current !== generation) return
        const pdfPage = await document.getPage(number)
        if (current !== generation) {
          onReleasePage(pdfPage)
          return
        }
        try {
          await annotations.prepare(number - 1)
          if (current !== generation) return
          setError(false)
          const size = pdfPage.getViewport({ scale: 1 })
          const viewport = pdfPage.getViewport({ scale: 150 / size.width })
          button.style.setProperty('--page-ratio', `${viewport.width} / ${viewport.height}`)
          const ratio = window.devicePixelRatio || 1
          canvas.width = base.width = Math.ceil(viewport.width * ratio)
          canvas.height = base.height = Math.ceil(viewport.height * ratio)
          const renderTask = pdfPage.render({
            canvas: base,
            viewport,
            transform: [ratio, 0, 0, ratio, 0, 0]
          })
          task = renderTask
          await renderTask.promise
          if (current !== generation) return
          const context = canvas.getContext('2d')!
          redraw = () => {
            context.setTransform(1, 0, 0, 1, 0, 0)
            context.clearRect(0, 0, canvas.width, canvas.height)
            context.drawImage(base, 0, 0)
            context.setTransform(ratio, 0, 0, ratio, 0, 0)
            paintThumbnailAnnotations(context, viewport, annotations.forPage(number - 1))
          }
          redraw()
        } finally {
          task = null
          onReleasePage(pdfPage)
        }
      }).catch((cause: unknown) => {
        if (current !== generation) return
        if (cause instanceof Error && cause.name === 'RenderingCancelledException') return
        setError(true)
      })
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting === visible) return
        visible = entry.isIntersecting
        render()
      },
      { root: button.closest('[data-page-scroll]'), rootMargin: '200px' }
    )
    observer.observe(button)
    return () => {
      generation++
      observer.disconnect()
      cancel()
      canvas.width = canvas.height = base.width = base.height = 0
    }
  }, [document, annotations, number, active, onReleasePage, enqueue])

  useEffect(() => {
    if (current && active) buttonRef.current?.scrollIntoView({ block: 'nearest' })
  }, [current, active])

  return (
    <button
      ref={(element) => {
        buttonRef.current = element
        ref(element)
      }}
      data-dragging={isDragSource}
      data-page-id={number - 1}
      aria-hidden={!!draggingStyle || undefined}
      style={{ ...draggingStyle, order: gridPosition }}
      type="button"
      aria-label={`${selecting ? 'Select' : 'Go to'} page ${position + 1}`}
      disabled={disabled}
      role={selecting ? 'option' : undefined}
      aria-selected={selecting ? selected : undefined}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => onPage(number, event.shiftKey)}
      className={cn(
        'mx-auto flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg p-3 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'bg-accent text-accent-foreground',
        !reorderDisabled && 'touch-none select-none data-[dragging=true]:cursor-grabbing',
        isDragSource && 'z-10 bg-accent shadow-lg'
      )}
    >
      <div
        className={cn(
          'relative w-[150px] overflow-hidden border bg-white shadow-sm',
          selected && 'ring-2 ring-primary'
        )}
        style={{ aspectRatio: 'var(--page-ratio, 612 / 792)' }}
      >
        <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
        {error && (
          <span className="absolute inset-0 grid place-items-center p-2 text-muted-foreground">
            Preview unavailable
          </span>
        )}
      </div>
      <span className="flex items-center gap-2">
        {selecting && (
          <span
            aria-hidden="true"
            className={cn(
              'grid size-4 place-items-center rounded border',
              selected && 'border-primary bg-primary text-primary-foreground'
            )}
          >
            {selected ? '✓' : ''}
          </span>
        )}
        {position + 1}
      </span>
    </button>
  )
})
