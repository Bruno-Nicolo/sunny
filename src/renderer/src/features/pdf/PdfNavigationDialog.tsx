import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { ChevronRight } from 'lucide-react'
import { Collapsible } from 'radix-ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { PdfDocumentViewProps } from './types'
import {
  paintThumbnailAnnotations,
  type ThumbnailAnnotations
} from './annotations/thumbnailAnnotations'

type Outline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>
type Props = {
  open: boolean
  onOpenChange(open: boolean): void
  document: PDFDocumentProxy
  annotations: ThumbnailAnnotations
  tab: PdfDocumentViewProps['navigationTab']
  onTabChange: PdfDocumentViewProps['onNavigationTabChange']
  page: number
  onPage(page: number): void
  onReleasePage(page: PDFPageProxy): void
  onDestination(destination: string | unknown[]): Promise<void>
  onError(message: string): void
}

type ThumbnailQueue = (render: () => Promise<void>) => Promise<void>

const PageThumbnail = memo(function PageThumbnail({
  document,
  annotations,
  number,
  selected,
  active,
  onPage,
  onReleasePage,
  enqueue
}: {
  document: PDFDocumentProxy
  annotations: ThumbnailAnnotations
  number: number
  selected: boolean
  active: boolean
  onPage(page: number): void
  onReleasePage(page: PDFPageProxy): void
  enqueue: ThumbnailQueue
}): React.JSX.Element {
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
      { root: button.closest('[data-slot="tabs-content"]'), rootMargin: '200px' }
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
    if (selected && active) buttonRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, active])

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`Go to page ${number}`}
      aria-current={selected ? 'page' : undefined}
      onClick={() => onPage(number)}
      className={cn(
        'mx-auto flex w-full flex-col items-center gap-2 rounded-lg p-3 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'bg-accent text-accent-foreground'
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
      <span>{number}</span>
    </button>
  )
})

function OutlineItems({
  items,
  prefix = '',
  onDestination,
  onError
}: Pick<Props, 'onDestination' | 'onError'> & {
  items: Outline
  prefix?: string
}): React.JSX.Element {
  return (
    <ul className="space-y-1">
      {items.map((item, index) => {
        const destination = item.dest
        const number = `${prefix}${index + 1}`
        return (
          <Collapsible.Root key={index} asChild>
            <li>
              <div className="flex items-start gap-1">
                {item.items.length > 0 ? (
                  <Collapsible.Trigger asChild>
                    <button
                      type="button"
                      aria-label={`Toggle section: ${item.title}`}
                      className="group mt-1 grid size-6 shrink-0 place-items-center rounded-md hover:bg-accent focus-visible:outline-ring"
                    >
                      <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                    </button>
                  </Collapsible.Trigger>
                ) : (
                  <span className="w-6 shrink-0" />
                )}
                {destination ? (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-1 py-1.5 text-left text-sm break-words hover:bg-accent focus-visible:outline-ring"
                    onClick={() =>
                      void onDestination(destination).catch(() =>
                        onError('The outline destination could not be opened.')
                      )
                    }
                  >
                    <span className="shrink-0 text-muted-foreground tabular-nums">{number}</span>
                    <span
                      className="min-w-0"
                      style={{
                        fontWeight: item.bold ? 600 : undefined,
                        fontStyle: item.italic ? 'italic' : undefined
                      }}
                    >
                      {item.title}
                    </span>
                  </button>
                ) : (
                  <span className="flex min-w-0 flex-1 items-start gap-2 px-1 py-1.5 text-sm break-words text-muted-foreground">
                    <span className="shrink-0 tabular-nums">{number}</span>
                    <span className="min-w-0">{item.title}</span>
                  </span>
                )}
              </div>
              {item.items.length > 0 && (
                <Collapsible.Content className="ml-3 border-l pl-2">
                  <OutlineItems
                    items={item.items}
                    prefix={`${number}.`}
                    onDestination={onDestination}
                    onError={onError}
                  />
                </Collapsible.Content>
              )}
            </li>
          </Collapsible.Root>
        )
      })}
    </ul>
  )
}

export function PdfNavigationDialog({
  open,
  onOpenChange,
  document,
  annotations,
  tab,
  onTabChange,
  page,
  onPage,
  onReleasePage,
  onDestination,
  onError
}: Props): React.JSX.Element {
  const queue = useRef(Promise.resolve())
  const enqueue = useCallback<ThumbnailQueue>((render) => {
    const current = queue.current.then(render)
    queue.current = current.catch(() => {})
    return current
  }, [])
  const [outline, setOutline] = useState<Outline | null>(null)
  const [outlineError, setOutlineError] = useState(false)
  useEffect(() => {
    let cancelled = false
    void document
      .getOutline()
      .then((items) => {
        if (!cancelled) setOutline(items ?? [])
      })
      .catch(() => {
        if (!cancelled) setOutlineError(true)
      })
    return () => {
      cancelled = true
    }
  }, [document])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(80vh,720px)] flex-col overflow-hidden sm:max-w-3xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          window.document
            .querySelector<HTMLButtonElement>('[aria-label="Toggle PDF navigation"]')
            ?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>PDF navigation</DialogTitle>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (value === 'pages' || value === 'outline') onTabChange(value)
          }}
          className="min-h-0 flex-1 gap-4"
        >
          <TabsList className="w-full shrink-0" aria-label="PDF navigation views">
            <TabsTrigger value="pages">Pages</TabsTrigger>
            <TabsTrigger value="outline">Outline</TabsTrigger>
          </TabsList>
          <TabsContent value="pages" className="min-h-0 overflow-y-auto">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(174px,1fr))] items-start gap-2 p-1">
              {Array.from({ length: document.numPages }, (_, index) => (
                <PageThumbnail
                  key={index}
                  document={document}
                  annotations={annotations}
                  number={index + 1}
                  selected={page === index + 1}
                  active={open}
                  onPage={(number) => {
                    onPage(number)
                    onOpenChange(false)
                  }}
                  onReleasePage={onReleasePage}
                  enqueue={enqueue}
                />
              ))}
            </div>
          </TabsContent>
          <TabsContent value="outline" className="min-h-0 overflow-y-auto px-3 pb-3">
            {outlineError ? (
              <p className="p-2 text-sm text-muted-foreground" role="status">
                The outline could not be loaded.
              </p>
            ) : outline === null ? (
              <p className="p-2 text-sm text-muted-foreground" role="status">
                Loading outline…
              </p>
            ) : outline.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">This PDF has no outline.</p>
            ) : (
              <OutlineItems
                items={outline}
                onDestination={async (destination) => {
                  await onDestination(destination)
                  onOpenChange(false)
                }}
                onError={onError}
              />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
