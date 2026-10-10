import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { ChevronRight } from 'lucide-react'
import { Collapsible } from 'radix-ui'
import { Sidebar, SidebarContent } from '@/components/ui/sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

type Outline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>
type Props = {
  document: PDFDocumentProxy
  page: number
  active: boolean
  onPage(page: number): void
  onDestination(destination: string | unknown[]): Promise<void>
  onError(message: string): void
}

function PageThumbnail({
  document,
  number,
  selected,
  active,
  onPage
}: {
  document: PDFDocumentProxy
  number: number
  selected: boolean
  active: boolean
  onPage(page: number): void
}): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const button = buttonRef.current
    const canvas = canvasRef.current
    if (!button || !canvas || !active) return
    let task: RenderTask | null = null
    let generation = 0
    let visible = false
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting === visible) return
        visible = entry.isIntersecting
        const current = ++generation
        task?.cancel()
        task = null
        canvas.width = canvas.height = 0
        if (!visible) return
        void document
          .getPage(number)
          .then(async (pdfPage) => {
            if (current !== generation) return
            const size = pdfPage.getViewport({ scale: 1 })
            const viewport = pdfPage.getViewport({ scale: 150 / size.width })
            button.style.setProperty('--page-ratio', `${viewport.width} / ${viewport.height}`)
            const ratio = window.devicePixelRatio || 1
            canvas.width = Math.ceil(viewport.width * ratio)
            canvas.height = Math.ceil(viewport.height * ratio)
            task = pdfPage.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
            await task.promise
          })
          .catch((cause: unknown) => {
            if (current !== generation) return
            if (cause instanceof Error && cause.name === 'RenderingCancelledException') return
            setError(true)
          })
      },
      { root: button.closest('[data-slot="tabs-content"]'), rootMargin: '200px' }
    )
    observer.observe(button)
    return () => {
      generation++
      observer.disconnect()
      task?.cancel()
      canvas.width = canvas.height = 0
    }
  }, [document, number, active])

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
        'mx-auto flex w-full flex-col items-center gap-2 rounded-lg p-3 text-xs outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        selected && 'bg-sidebar-accent text-sidebar-accent-foreground'
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
}

function OutlineItems({
  items,
  onDestination,
  onError
}: Pick<Props, 'onDestination' | 'onError'> & { items: Outline }): React.JSX.Element {
  return (
    <ul className="space-y-1">
      {items.map((item, index) => {
        const destination = item.dest
        return (
          <Collapsible.Root key={index} asChild>
            <li>
              <div className="flex items-start gap-1">
                {item.items.length > 0 ? (
                  <Collapsible.Trigger asChild>
                    <button
                      type="button"
                      aria-label={`Toggle section: ${item.title}`}
                      className="group mt-1 grid size-6 shrink-0 place-items-center rounded-md hover:bg-sidebar-accent focus-visible:outline-sidebar-ring"
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
                    className="min-w-0 flex-1 rounded-md px-1 py-1.5 text-left text-sm break-words hover:bg-sidebar-accent focus-visible:outline-sidebar-ring"
                    onClick={() =>
                      void onDestination(destination).catch(() =>
                        onError('The outline destination could not be opened.')
                      )
                    }
                  >
                    <span
                      style={{
                        fontWeight: item.bold ? 600 : undefined,
                        fontStyle: item.italic ? 'italic' : undefined
                      }}
                    >
                      {item.title}
                    </span>
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 px-1 py-1.5 text-sm break-words text-muted-foreground">
                    {item.title}
                  </span>
                )}
              </div>
              {item.items.length > 0 && (
                <Collapsible.Content className="ml-3 border-l pl-2">
                  <OutlineItems
                    items={item.items}
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

export function PdfSidebar({
  document,
  page,
  active,
  onPage,
  onDestination,
  onError
}: Props): React.JSX.Element {
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
    <Sidebar
      collapsible="none"
      className="h-full w-60 shrink-0 border-r"
      aria-label="PDF navigation"
    >
      <SidebarContent className="min-h-0 overflow-hidden">
        <Tabs defaultValue="pages" className="h-full min-h-0 gap-0">
          <TabsList className="mx-3 my-3 w-auto shrink-0" aria-label="PDF navigation views">
            <TabsTrigger value="pages">Pages</TabsTrigger>
            <TabsTrigger value="outline">Outline</TabsTrigger>
          </TabsList>
          <TabsContent value="pages" className="min-h-0 space-y-2 overflow-y-auto px-2 pb-2">
            {Array.from({ length: document.numPages }, (_, index) => (
              <PageThumbnail
                key={index}
                document={document}
                number={index + 1}
                selected={page === index + 1}
                active={active}
                onPage={onPage}
              />
            ))}
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
              <OutlineItems items={outline} onDestination={onDestination} onError={onError} />
            )}
          </TabsContent>
        </Tabs>
      </SidebarContent>
    </Sidebar>
  )
}
