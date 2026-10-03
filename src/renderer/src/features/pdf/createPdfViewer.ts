import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  GlobalWorkerOptions,
  PasswordResponses,
  PermissionFlag,
  getDocument,
  type PDFDocumentProxy
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import { highlightColors } from './highlightColors'
import { validateImage } from './imageFiles'
import { containsDigitalSignature } from './signatures'
import type {
  PasswordRequest,
  PdfAnnotationOptions,
  PdfDocumentHandle,
  PdfViewPosition,
  ViewerSnapshot
} from './types'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

type Options = {
  container: HTMLDivElement
  viewerElement: HTMLDivElement
  data: ArrayBuffer
  initialView: PdfViewPosition
  annotationOptions: PdfAnnotationOptions
  onSnapshot(snapshot: ViewerSnapshot): void
  onDirtyChange(dirty: boolean): void
  onLoadingChange(loading: boolean): void
  onPasswordRequest(request: PasswordRequest | null): void
  onError(message: string): void
  onDocumentReady(document: PDFDocumentProxy): void
}

export type PdfViewerController = PdfDocumentHandle & {
  navigateToDestination(destination: string | unknown[]): Promise<void>
  setAnnotationOptions(options: PdfAnnotationOptions): void
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
  onDocumentReady
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
    annotationEditorHighlightColors: highlightColors
      .map(({ name, value }) => `${name.toLowerCase()}=${value}`)
      .join(','),
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
  let annotationOptions = initialOptions
  let editorMode: number = AnnotationEditorType.NONE
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
  const setHighlightColor = (): void => {
    eventBus.dispatch('switchannotationeditorparams', {
      source: null,
      type: AnnotationEditorParamsType.HIGHLIGHT_COLOR,
      value: annotationOptions.highlightColor
    })
  }
  const setHighlightMode = (): void => {
    if (!snapshot.canAnnotate || loading || destroyed) return
    viewer.annotationEditorMode = {
      mode:
        annotationOptions.active && annotationOptions.highlightEnabled
          ? AnnotationEditorType.HIGHLIGHT
          : AnnotationEditorType.NONE
    }
  }
  eventBus.on(
    'annotationeditormodechanged',
    ({ mode }: { mode: number }) => {
      editorMode = mode
    },
    { signal: lifetime.signal }
  )
  // PDF.js requests mode changes when pasting or selecting an existing image.
  eventBus.on(
    'switchannotationeditormode',
    (options: { mode: number }) => {
      if (annotationOptions.active && snapshot.canAnnotate && !loading)
        viewer.annotationEditorMode = options
    },
    { signal: lifetime.signal }
  )
  eventBus.on(
    'pagesinit',
    () => {
      viewer.currentPageNumber = Math.max(1, Math.min(initialView.page, viewer.pagesCount))
      viewer.currentScaleValue = initialView.scale || 'page-width'
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
      setHighlightMode()
      setHighlightColor()
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

  const enterImageMode = async (): Promise<void> => {
    if (editorMode === AnnotationEditorType.STAMP) return
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        eventBus.off('annotationeditormodechanged', onModeChanged)
        lifetime.signal.removeEventListener('abort', onAbort)
      }
      const onModeChanged = ({ mode }: { mode: number }): void => {
        cleanup()
        if (mode === AnnotationEditorType.STAMP) resolve()
        else reject(new Error('Image insertion was interrupted. Try again.'))
      }
      const onAbort = (): void => {
        cleanup()
        reject(new Error('Image insertion was interrupted. Try again.'))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('The image editor is not ready. Try again.'))
      }, 10000)
      eventBus.on('annotationeditormodechanged', onModeChanged)
      lifetime.signal.addEventListener('abort', onAbort, { once: true })
      try {
        viewer.annotationEditorMode = { mode: AnnotationEditorType.STAMP }
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }

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
    async addImage(file) {
      if (destroyed || loading || !snapshot.canAnnotate)
        throw new Error('This PDF is not ready for editing.')
      await validateImage(file)
      if (destroyed || !annotationOptions.active) return
      await enterImageMode()
      if (destroyed || !annotationOptions.active) return
      container.focus()
      eventBus.dispatch('switchannotationeditorparams', {
        source: null,
        type: AnnotationEditorParamsType.CREATE,
        value: { bitmapFile: file }
      })
    },
    undo() {
      if (!destroyed) eventBus.dispatch('editingaction', { source: null, name: 'undo' })
    },
    redo() {
      if (!destroyed) eventBus.dispatch('editingaction', { source: null, name: 'redo' })
    },
    setAnnotationOptions(options) {
      const modeChanged =
        annotationOptions.active !== options.active ||
        annotationOptions.highlightEnabled !== options.highlightEnabled
      const colorChanged = annotationOptions.highlightColor !== options.highlightColor
      annotationOptions = options
      if (modeChanged) setHighlightMode()
      if (colorChanged && !destroyed && !loading) setHighlightColor()
    },
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
