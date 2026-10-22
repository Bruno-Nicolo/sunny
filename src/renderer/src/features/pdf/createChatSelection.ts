import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFViewer, EventBus } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import type { ChatAttachment, DocumentSource, PdfRect } from '../../../../shared/ai'
import { normalizedRect } from './annotations/geometry'
import { indexPdf, regionText, regionImage, type IndexedPdf } from './chatDocument'

type Options = {
  viewer: PDFViewer
  eventBus: EventBus
  container: HTMLDivElement
  signal: AbortSignal
  document(): PDFDocumentProxy | null
  release(page: PDFPageProxy): void
  onError(message: string): void
}

export function createChatSelection({
  viewer,
  eventBus,
  container,
  signal,
  document,
  release,
  onError
}: Options): {
  index(progress: (page: number, total: number) => void, signal: AbortSignal): Promise<IndexedPdf>
  selectRegion(callback: ((attachment: ChatAttachment) => void) | null): void
  selectedText(): ChatAttachment[]
  cite(source: DocumentSource): void
  deactivate(): void
} {
  let indexed: IndexedPdf | null = null
  let pendingIndex: Promise<IndexedPdf> | null = null
  let indexSignal: AbortSignal | null = null
  let regionCallback: ((attachment: ChatAttachment) => void) | null = null
  let captureAbort: AbortController | null = null
  const citationDuration = 2000
  let citationStartedAt = 0
  let citation: DocumentSource | null = null
  let citationTimer: ReturnType<typeof setTimeout> | undefined
  let drag: { page: number; x: number; y: number; pointer: number; box: HTMLDivElement } | null =
    null
  const clearDrag = (): void => {
    drag?.box.remove()
    drag = null
  }
  const selectRegion = (callback: typeof regionCallback): void => {
    captureAbort?.abort()
    captureAbort = null
    regionCallback = callback
    for (const name of [
      'chat-region-mode',
      'cursor-crosshair!',
      'select-none!',
      '[&_*]:cursor-crosshair!',
      '[&_*]:select-none!'
    ])
      container.classList.toggle(name, Boolean(callback))
    clearDrag()
  }
  const renderCitation = (): void => {
    container.querySelectorAll('.chat-citation').forEach((element) => element.remove())
    if (!citation) return
    const page = viewer.getPageView(citation.page - 1)
    if (!page) return
    for (const rect of citation.rects) {
      const bounds = [
        ...page.viewport.convertToViewportPoint(rect[0], rect[1]),
        ...page.viewport.convertToViewportPoint(rect[2], rect[3])
      ]
      const element = window.document.createElement('div')
      element.className =
        'chat-citation pointer-events-none absolute z-20 border border-[#4f46e5] bg-[#6366f1]/22 animate-[chat-citation-fade_var(--chat-citation-duration)_cubic-bezier(0.2,0,0,1)_forwards]'
      element.style.setProperty('--chat-citation-duration', `${citationDuration}ms`)
      Object.assign(element.style, {
        animationDelay: `${citationStartedAt - performance.now()}ms`,
        left: `${Math.min(bounds[0], bounds[2])}px`,
        top: `${Math.min(bounds[1], bounds[3])}px`,
        width: `${Math.abs(bounds[2] - bounds[0])}px`,
        height: `${Math.abs(bounds[3] - bounds[1])}px`
      })
      page.div.append(element)
    }
  }
  for (const event of ['pagerendered', 'scalechanging', 'rotationchanging'])
    eventBus.on(event, renderCitation, { signal })
  signal.addEventListener(
    'abort',
    () => {
      selectRegion(null)
      clearTimeout(citationTimer)
    },
    { once: true }
  )
  container.addEventListener(
    'pointerdown',
    (event) => {
      if (!regionCallback || event.button !== 0) return
      const element = (event.target as HTMLElement).closest<HTMLElement>('.page[data-page-number]')
      if (!element || !container.contains(element)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const bounds = element.getBoundingClientRect()
      const box = window.document.createElement('div')
      box.className =
        'chat-region-drag pointer-events-none absolute z-20 border-2 border-dashed border-[#4f46e5] bg-[#6366f1]/22'
      element.append(box)
      drag = {
        page: Number(element.dataset.pageNumber),
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        pointer: event.pointerId,
        box
      }
      container.setPointerCapture(event.pointerId)
    },
    { capture: true, signal }
  )
  const dragRect = (event: PointerEvent): PdfRect | null => {
    if (!drag) return null
    const page = viewer.getPageView(drag.page - 1)
    const bounds = page.div.getBoundingClientRect()
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))
    const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
    return normalizedRect([drag.x, drag.y], [x, y])
  }
  container.addEventListener(
    'pointermove',
    (event) => {
      const rect = dragRect(event)
      if (!drag || !rect) return
      event.preventDefault()
      event.stopImmediatePropagation()
      Object.assign(drag.box.style, {
        left: `${rect[0]}px`,
        top: `${rect[1]}px`,
        width: `${rect[2] - rect[0]}px`,
        height: `${rect[3] - rect[1]}px`
      })
    },
    { capture: true, signal }
  )
  container.addEventListener(
    'pointerup',
    (event) => {
      const bounds = dragRect(event)
      const selection = drag
      const callback = regionCallback
      if (!selection || !bounds || !callback) return
      event.preventDefault()
      event.stopImmediatePropagation()
      clearDrag()
      if (container.hasPointerCapture(event.pointerId))
        container.releasePointerCapture(event.pointerId)
      if (bounds[2] - bounds[0] < 5 || bounds[3] - bounds[1] < 5) return
      const view = viewer.getPageView(selection.page - 1)
      const rect = normalizedRect(
        view.viewport.convertToPdfPoint(bounds[0], bounds[1]),
        view.viewport.convertToPdfPoint(bounds[2], bounds[3])
      )
      const rotation = view.viewport.rotation
      const capture = new AbortController()
      captureAbort = capture
      const captureSignal = AbortSignal.any([signal, capture.signal])
      void (async () => {
        const pdf = document()
        if (!pdf) throw new Error('The PDF is not ready.')
        const page = await pdf.getPage(selection.page)
        try {
          const text = await regionText(page, rect)
          const image = await regionImage(page, rect, rotation, captureSignal)
          if (!captureSignal.aborted && regionCallback === callback)
            callback({
              id: `a_${crypto.randomUUID()}`,
              kind: 'region',
              page: selection.page,
              rects: [rect],
              text,
              image
            })
        } finally {
          release(page)
        }
      })().catch((error) => {
        if (!captureSignal.aborted)
          onError(error instanceof Error ? error.message : 'Cannot capture this region.')
      })
    },
    { capture: true, signal }
  )
  container.addEventListener('pointercancel', clearDrag, { signal })
  container.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && regionCallback) {
        event.preventDefault()
        selectRegion(null)
      }
    },
    { signal }
  )

  return {
    selectRegion,
    deactivate() {
      selectRegion(null)
    },
    async index(progress, requestSignal) {
      if (indexed) return indexed
      if (pendingIndex && indexSignal?.aborted) await pendingIndex.catch(() => {})
      if (!pendingIndex) {
        const pdf = document()
        if (!pdf) throw new Error('Wait for the PDF to finish opening.')
        const combined = AbortSignal.any([signal, requestSignal])
        indexSignal = combined
        pendingIndex = indexPdf(pdf, combined, progress, release)
          .then((result) => {
            indexed = result
            return result
          })
          .finally(() => {
            pendingIndex = null
          })
      }
      return pendingIndex
    },
    selectedText() {
      const selection = window.getSelection()
      if (
        !selection?.rangeCount ||
        selection.isCollapsed ||
        !selection.anchorNode ||
        !container.contains(selection.anchorNode) ||
        !selection.focusNode ||
        !container.contains(selection.focusNode)
      )
        return []
      const original = selection.getRangeAt(0)
      const result: ChatAttachment[] = []
      for (const element of container.querySelectorAll<HTMLElement>('.page[data-page-number]')) {
        const layer = element.querySelector('.textLayer')
        if (!layer || !original.intersectsNode(layer)) continue
        const page = Number(element.dataset.pageNumber)
        const view = viewer.getPageView(page - 1)
        const range = window.document.createRange()
        range.selectNodeContents(layer)
        if (original.compareBoundaryPoints(Range.START_TO_START, range) > 0)
          range.setStart(original.startContainer, original.startOffset)
        if (original.compareBoundaryPoints(Range.END_TO_END, range) < 0)
          range.setEnd(original.endContainer, original.endOffset)
        const text = range.toString().trim()
        if (!text) continue
        const bounds = element.getBoundingClientRect()
        const seen = new Set<string>()
        const rects: PdfRect[] = []
        for (const rect of range.getClientRects()) {
          if (
            rect.width < 0.5 ||
            rect.height < 0.5 ||
            rect.bottom <= bounds.top ||
            rect.top >= bounds.bottom
          )
            continue
          const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`
          if (seen.has(key)) continue
          seen.add(key)
          rects.push(
            normalizedRect(
              view.viewport.convertToPdfPoint(
                Math.max(rect.left, bounds.left) - bounds.left,
                Math.max(rect.top, bounds.top) - bounds.top
              ),
              view.viewport.convertToPdfPoint(
                Math.min(rect.right, bounds.right) - bounds.left,
                Math.min(rect.bottom, bounds.bottom) - bounds.top
              )
            )
          )
        }
        if (rects.length)
          result.push({ id: `a_${crypto.randomUUID()}`, kind: 'text', page, text, rects })
      }
      selection.removeAllRanges()
      return result
    },
    cite(source) {
      const pdf = document()
      if (
        !pdf ||
        !container.clientWidth ||
        !container.clientHeight ||
        source.page < 1 ||
        source.page > pdf.numPages
      )
        return
      citation = source
      citationStartedAt = performance.now()
      const rect = source.rects[0]
      viewer.scrollPageIntoView({
        pageNumber: source.page,
        destArray: [null, { name: 'XYZ' }, rect[0], rect[3], null]
      })
      renderCitation()
      clearTimeout(citationTimer)
      citationTimer = setTimeout(() => {
        citation = null
        renderCitation()
      }, citationDuration)
    }
  }
}
