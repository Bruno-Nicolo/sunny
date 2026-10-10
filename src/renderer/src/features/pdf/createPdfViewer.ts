import {
  AnnotationEditorType,
  GlobalWorkerOptions,
  PasswordResponses,
  PermissionFlag,
  getDocument,
  type PDFDocumentProxy
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import { pdfHighlightColors } from './annotations/highlight/highlightEditor'
import { createAnnotationController } from './annotations/createAnnotationController'
import type { AnnotationOptions } from './annotations/types'
import type { TextEditorSettings } from './annotations/text/types'
import { containsDigitalSignature } from './signatures'
import type { PasswordRequest, PdfDocumentHandle, PdfViewPosition, ViewerSnapshot } from './types'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

type Options = {
  container: HTMLDivElement
  viewerElement: HTMLDivElement
  data: ArrayBuffer
  initialView: PdfViewPosition
  annotationOptions: AnnotationOptions
  onSnapshot(snapshot: ViewerSnapshot): void
  onDirtyChange(dirty: boolean): void
  onLoadingChange(loading: boolean): void
  onPasswordRequest(request: PasswordRequest | null): void
  onError(message: string): void
  onDocumentReady(document: PDFDocumentProxy): void
  onTextEditorChange(settings: TextEditorSettings | null): void
}

export type PdfViewerController = PdfDocumentHandle & {
  navigateToDestination(destination: string | unknown[]): Promise<void>
  setAnnotationOptions(options: AnnotationOptions): void
  destroy(): Promise<void>
}

// Own one viewer and loading task; destroy it before reusing its DOM containers.
export function createPdfViewer({
  container,
  viewerElement,
  data,
  initialView,
  annotationOptions: initialOptions,
  onSnapshot,
  onDirtyChange,
  onLoadingChange,
  onPasswordRequest,
  onError,
  onDocumentReady,
  onTextEditorChange
}: Options): PdfViewerController {
  const lifetime = new AbortController()
  const eventBus = new EventBus()
  const linkService = new PDFLinkService({ eventBus })
  const viewer = new PDFViewer({
    container,
    viewer: viewerElement,
    eventBus,
    linkService,
    annotationEditorMode: AnnotationEditorType.NONE,
    annotationEditorHighlightColors: pdfHighlightColors,
    enablePermissions: true,
    supportsPinchToZoom: true,
    removePageBorders: true,
    // @ts-expect-error PDF.js uses abortSignal to release observers, but its declaration omits it.
    abortSignal: lifetime.signal
  })
  linkService.setViewer(viewer)
  let document: PDFDocumentProxy | null = null
  let destroyed = false
  let loading = true
  let scrollFrame: number | null = null
  let destinationRequest = 0
  let snapshot: ViewerSnapshot = {
    ...initialView,
    pages: 0,
    zoomPercent: 100,
    canAnnotate: false,
    signed: false
  }

  const emitSnapshot = (changes: Partial<ViewerSnapshot>): void => {
    if (destroyed) return
    snapshot = { ...snapshot, ...changes }
    onSnapshot(snapshot)
  }
  const annotations = createAnnotationController({
    eventBus,
    viewer,
    container,
    signal: lifetime.signal,
    initialOptions,
    onDirtyChange,
    onTextEditorChange
  })
  eventBus.on(
    'pagesinit',
    () => {
      viewer.currentPageNumber = Math.max(1, Math.min(initialView.page, viewer.pagesCount))
      viewer.currentScaleValue = initialView.scale || 'page-fit'
      scrollFrame = requestAnimationFrame(() => {
        container.scrollTop = initialView.scrollTop
      })
      emitSnapshot({
        page: viewer.currentPageNumber,
        pages: viewer.pagesCount,
        scale: viewer.currentScaleValue,
        zoomPercent: Math.round(viewer.currentScale * 100)
      })
      loading = false
      annotations.initialize(snapshot.canAnnotate)
      onLoadingChange(false)
    },
    { signal: lifetime.signal }
  )
  eventBus.on(
    'pagechanging',
    ({ pageNumber }: { pageNumber: number }) => {
      emitSnapshot({ page: pageNumber })
    },
    { signal: lifetime.signal }
  )
  eventBus.on(
    'scalechanging',
    ({ scale, presetValue }: { scale: number; presetValue?: string }) => {
      emitSnapshot({ scale: presetValue || String(scale), zoomPercent: Math.round(scale * 100) })
    },
    { signal: lifetime.signal }
  )
  const handleScroll = (): void => emitSnapshot({ scrollTop: container.scrollTop })
  container.addEventListener('scroll', handleScroll, { passive: true, signal: lifetime.signal })
  let containerSize = container.getBoundingClientRect()
  const resizeObserver = new ResizeObserver(() => {
    const size = container.getBoundingClientRect()
    if (size.width === containerSize.width && size.height === containerSize.height) return
    containerSize = size
    if (destroyed || loading || !container.clientWidth || !container.clientHeight) return
    const scale = viewer.currentScaleValue
    if (scale && Number.isNaN(Number(scale))) viewer.currentScaleValue = scale
    viewer.update()
  })
  resizeObserver.observe(container)

  onLoadingChange(true)
  onPasswordRequest(null)
  const loadingTask = getDocument({ data: data.slice() })
  loadingTask.onPassword = (submit: (password: string) => void, reason: number): void => {
    if (destroyed) return
    onPasswordRequest({
      incorrect: reason === PasswordResponses.INCORRECT_PASSWORD,
      submit: (password) => {
        if (!destroyed) submit(password)
      }
    })
  }
  void loadingTask.promise
    .then(async (pdfDocument) => {
      if (destroyed) return
      document = pdfDocument
      const permissions = await pdfDocument.getPermissions()
      if (destroyed) return
      const signed = containsDigitalSignature(new Uint8Array(data))
      const canAnnotate =
        !signed && (permissions === null || permissions.has(PermissionFlag.MODIFY_ANNOTATIONS))
      emitSnapshot({ pages: pdfDocument.numPages, canAnnotate, signed })
      // @ts-expect-error PDF.js calls this hook, but its declaration types it as null.
      pdfDocument.annotationStorage.onSetModified = () => {
        if (!destroyed) onDirtyChange(true)
      }
      linkService.setDocument(pdfDocument)
      viewer.setDocument(pdfDocument)
      onDocumentReady(pdfDocument)
    })
    .catch((error: unknown) => {
      if (destroyed) return
      loading = false
      onLoadingChange(false)
      onError(error instanceof Error ? error.message : 'The PDF could not be opened.')
    })

  return {
    async navigateToDestination(destination) {
      if (destroyed || !document) return
      const request = ++destinationRequest
      const target =
        typeof destination === 'string' ? await document.getDestination(destination) : destination
      if (!target) throw new Error('The outline destination is missing.')
      const reference = target[0]
      const pageIndex =
        typeof reference === 'number'
          ? reference
          : await document.getPageIndex(reference as { num: number; gen: number })
      if (destroyed || request !== destinationRequest) return
      viewer.scrollPageIntoView({ pageNumber: pageIndex + 1, destArray: target })
    },
    async saveDocument() {
      if (destroyed || !document) throw new Error('The PDF is not ready.')
      annotations.commit()
      return document.saveDocument()
    },
    setPage(page) {
      if (!destroyed) viewer.currentPageNumber = page
    },
    setScale(scale) {
      if (!destroyed) viewer.currentScaleValue = scale
    },
    zoomIn() {
      if (!destroyed) viewer.increaseScale()
    },
    zoomOut() {
      if (!destroyed) viewer.decreaseScale()
    },
    navigateHorizontally(direction) {
      if (destroyed || !viewer.pagesCount) return
      if (container.scrollWidth > container.clientWidth) {
        container.scrollBy({ left: direction * 40, behavior: 'smooth' })
      } else {
        viewer.currentPageNumber = Math.min(
          viewer.pagesCount,
          Math.max(1, viewer.currentPageNumber + direction)
        )
      }
    },
    addImage: annotations.addImage,
    undo: annotations.undo,
    redo: annotations.redo,
    setAnnotationOptions: annotations.setOptions,
    async destroy() {
      if (destroyed) return
      destroyed = true
      resizeObserver.disconnect()
      lifetime.abort()
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      if (document) document.annotationStorage.onSetModified = null
      // @ts-expect-error PDF.js accepts null to detach a document, but its declaration omits it.
      viewer.setDocument(null)
      linkService.setDocument(null)
      document = null
      await loadingTask.destroy()
    }
  }
}
