import { useRef, useState, type CSSProperties } from 'react'
import { DragDropProvider, DragOverlay, type DragMoveEvent } from '@dnd-kit/react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { dragSensors } from '@/lib/dragSensors'
import type { PageAnnotations } from './annotations/pageAnnotations'
import { PageThumbnail, type ThumbnailQueue } from './PageThumbnail'
import { PageDragPreview, type PageDragImage } from './PageDragPreview'
import { findPageDropBefore, movePages } from './pageOperations'

type Cell = { page: number; element: HTMLElement }
type Drag = {
  pages: ReadonlySet<number>
  source: number
  sourceStyle: CSSProperties
  remaining: Cell[]
  columns: number
  height: number
  images: PageDragImage[]
  before: number | null
  allowed: boolean
}
type Props = {
  document: PDFDocumentProxy
  annotations: PageAnnotations
  order: number[]
  selected: ReadonlySet<number>
  selecting: boolean
  page: number
  busy: boolean
  canReorder: boolean
  open: boolean
  onOrderChange(order: number[]): void
  onPage(page: number, range: boolean): void
  onReleasePage(page: PDFPageProxy): void
  enqueue: ThumbnailQueue
}

const hiddenPage: CSSProperties = { display: 'none' }

export function PdfPageGrid({
  document,
  annotations,
  order,
  selected,
  selecting,
  page,
  busy,
  canReorder,
  open,
  onOrderChange,
  onPage,
  onReleasePage,
  enqueue
}: Props): React.JSX.Element {
  const thumbnails = useRef<HTMLDivElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const activeDrag = useRef<Drag | null>(null)
  const updateDrag = (next: Drag | null): void => {
    activeDrag.current = next
    setDrag(next)
  }
  const slotIndex =
    drag?.before === null
      ? drag.remaining.length
      : (drag?.remaining.findIndex((cell) => cell.page === drag.before) ?? 0)
  const positions = new Map<number, number>()
  drag?.remaining.forEach((cell, index) =>
    positions.set(cell.page, index + (index >= slotIndex ? 1 : 0))
  )

  const updatePosition = (event: DragMoveEvent): void => {
    const grid = thumbnails.current
    const current = activeDrag.current
    if (!grid || !current) return
    const { x, y } = event.operation.position.current
    const scroll = grid.closest('[data-page-scroll]')!.getBoundingClientRect()
    const allowed = x >= scroll.left && x <= scroll.right && y >= scroll.top && y <= scroll.bottom
    let before = current.before
    const gap = slot.current?.getBoundingClientRect()
    if (allowed && !(gap && x >= gap.left && x <= gap.right && y >= gap.top && y <= gap.bottom)) {
      const bounds = grid.getBoundingClientRect()
      const cells = current.remaining.map(({ page, element }) => {
        const left = bounds.left + element.offsetLeft
        const top = bounds.top + element.offsetTop
        return {
          page,
          left,
          top,
          right: left + element.offsetWidth,
          bottom: top + element.offsetHeight
        }
      })
      before = findPageDropBefore(cells, { x, y })
    }
    if (before !== current.before || allowed !== current.allowed)
      updateDrag({ ...current, before, allowed })
  }

  return (
    <DragDropProvider
      sensors={dragSensors}
      onDragStart={(event) => {
        const grid = thumbnails.current
        const source = event.operation.source
        if (!grid || !source?.element) return
        const id = Number(source.id) - 1
        const pages = new Set(
          selecting && selected.has(id) ? order.filter((page) => selected.has(page)) : [id]
        )
        const cells = [...grid.querySelectorAll<HTMLElement>('[data-page-id]')].map((element) => ({
          page: Number(element.dataset.pageId),
          element
        }))
        const elements = new Map(cells.map((cell) => [cell.page, cell.element]))
        const bounds = grid.getBoundingClientRect()
        const rect = source.element.getBoundingClientRect()
        const images = [...pages]
          .filter((page) => page !== id)
          .slice(0, 3)
          .concat(id)
          .map((page) => {
            const original = elements.get(page)!.querySelector('canvas')!
            const canvas = window.document.createElement('canvas')
            canvas.width = original.width || 150
            canvas.height = original.height || 194
            if (original.width && original.height)
              canvas.getContext('2d')?.drawImage(original, 0, 0)
            return { number: order.indexOf(page) + 1, canvas }
          })
        const remaining = cells.filter((cell) => !pages.has(cell.page))
        updateDrag({
          pages,
          source: id,
          remaining,
          images,
          height: rect.height,
          sourceStyle: {
            position: 'absolute',
            left: rect.left - bounds.left,
            top: rect.top - bounds.top,
            width: rect.width,
            height: rect.height,
            opacity: 0,
            pointerEvents: 'none'
          },
          columns: getComputedStyle(grid)
            .gridTemplateColumns.split(/\s+/)
            .filter((width) => parseFloat(width) > 0).length,
          before: order.slice(order.indexOf(id) + 1).find((page) => !pages.has(page)) ?? null,
          allowed: true
        })
      }}
      onDragMove={updatePosition}
      onDragEnd={(event) => {
        const current = activeDrag.current
        updateDrag(null)
        if (!busy && !event.canceled && current?.allowed)
          onOrderChange(movePages(order, current.pages, current.before))
      }}
    >
      <div
        ref={thumbnails}
        aria-label="PDF pages"
        role={selecting ? 'listbox' : 'group'}
        aria-multiselectable={selecting || undefined}
        aria-busy={busy}
        className="relative grid grid-cols-[repeat(auto-fit,minmax(174px,1fr))] items-start gap-2 p-1"
        style={
          drag
            ? { gridTemplateColumns: `repeat(${drag.columns}, minmax(0, 1fr))`, overflow: 'clip' }
            : undefined
        }
      >
        {order.map((original, index) => (
          <PageThumbnail
            key={original}
            document={document}
            annotations={annotations}
            number={original + 1}
            position={index}
            selecting={selecting}
            current={page === original + 1}
            selected={selecting ? selected.has(original) : page === original + 1}
            draggingStyle={
              drag?.pages.has(original)
                ? original === drag.source
                  ? drag.sourceStyle
                  : hiddenPage
                : undefined
            }
            gridPosition={positions.get(original)}
            disabled={busy}
            reorderDisabled={!canReorder || busy || order.length < 2}
            active={open}
            onPage={onPage}
            onReleasePage={onReleasePage}
            enqueue={enqueue}
          />
        ))}
        {drag && (
          <div
            ref={slot}
            data-page-drop-slot
            role="option"
            aria-selected={false}
            aria-disabled="true"
            aria-label="Insert pages here"
            style={{
              height: drag.height,
              gridColumn: (slotIndex % drag.columns) + 1,
              gridRow: Math.floor(slotIndex / drag.columns) + 1
            }}
          />
        )}
      </div>
      <DragOverlay disabled={(source) => !source} dropAnimation={null}>
        {drag && <PageDragPreview count={drag.pages.size} images={drag.images} />}
      </DragOverlay>
    </DragDropProvider>
  )
}
