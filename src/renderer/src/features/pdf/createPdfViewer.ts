import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?worker&url'
import type { PdfSource } from '../../../../shared/contracts'
import {
  AnnotationEditorType,
  GlobalWorkerOptions,
  PasswordResponses,
  PermissionFlag,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  EventBus,
  FindState,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  RenderingStates,
  SpreadMode
} from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import { validatePageOrder } from './pageOperations'
import { FileRangeTransport } from './fileRangeTransport'
import { createAnnotationController } from './annotations/createAnnotationController'
import type { AnnotationOptions } from './annotations/types'
import type { PageAnnotations } from './annotations/pageAnnotations'
import type { TextEditorSettings } from './annotations/text/types'
import { createKeyboardScroll } from './keyboardScroll'
import { createPresentationMode } from './createPresentationMode'
import { printPdf } from './printPdf'
import { createChatSelection } from './createChatSelection'
import type {
  PasswordRequest,
  PdfDocumentHandle,
  PdfSearchOptions,
  PdfSearchSnapshot,
  PdfViewPosition,
  ViewerSnapshot
} from './types'

GlobalWorkerOptions.workerSrc = workerSrc

type Options = {
  container: HTMLDivElement
  viewerElement: HTMLDivElement
  source: PdfSource
  initialView: PdfViewPosition
  annotationOptions: AnnotationOptions
  onSnapshot(snapshot: ViewerSnapshot): void
  onDirtyChange(dirty: boolean): void
  onLoadingChange(loading: boolean): void
  onPasswordRequest(request: PasswordRequest | null): void
  onError(message: string): void
  onDocumentReady(
    document: PDFDocumentProxy,
    thumbnails: PageAnnotations,
    canReorder: boolean
  ): void
  onTextEditorChange(settings: TextEditorSettings | null): void
  onSearchChange(snapshot: PdfSearchSnapshot): void
}

export type PdfViewerController = Omit<
  PdfDocumentHandle,
  'openSearch' | 'confirmPageChanges' | 'preparePageChanges'
> & {
  search(query: string, options: PdfSearchOptions, previous?: boolean): void
  closeSearch(): void
  extractPages(order: number[]): Promise<Uint8Array>
  navigateToDestination(destination: string | unknown[]): Promise<void>
  setAnnotationOptions(options: AnnotationOptions): void
  releasePageResources(page: PDFPageProxy): void
  destroy(): Promise<void>
}

// Own one viewer and loading task; destroy it before reusing its DOM containers.
export function createPdfViewer({
  container,
  viewerElement,
  source,
  initialView,
  annotationOptions: initialOptions,
  onSnapshot,
  onDirtyChange,
  onLoadingChange,
  onPasswordRequest,
  onError,
  onDocumentReady,
  onTextEditorChange,
  onSearchChange
}: Options): PdfViewerController {
  const lifetime = new AbortController()
  const scrollKeyboard = createKeyboardScroll(container, lifetime.signal)
  const eventBus = new EventBus()
  const linkService = new PDFLinkService({ eventBus })
  const findController = new PDFFindController({ linkService, eventBus })
  const viewer = new PDFViewer({
    container,
    viewer: viewerElement,
    eventBus,
    linkService,
    findController,
    annotationEditorMode: AnnotationEditorType.DISABLE,
    enablePermissions: true,
    supportsPinchToZoom: true,
    // @ts-expect-error PDF.js uses abortSignal to release observers, but its declaration omits it.
    abortSignal: lifetime.signal
  })
  linkService.setViewer(viewer)
  let document: PDFDocumentProxy | null = null
  let destroyed = false
  let loading = true
  let canReorder = false
  let password: string | undefined
  const releasePage = (page: PDFPageProxy): void => {
    if (
      destroyed ||
      viewer.getPageView(page.pageNumber - 1)?.renderingState === RenderingStates.INITIAL
    )
      page.cleanup()
  }
  let composing = false
  let pendingWheelDelta = 0
  // Chromium reports trackpad pinches as wheel events with ctrlKey set.
  container.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      // Pinches emit small pixel deltas; wheel notches already reach the cap below.
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? container.clientHeight
            : 10
      const delta = Math.max(-100, Math.min(100, event.deltaY * unit))
      if (delta * pendingWheelDelta < 0) pendingWheelDelta = 0
      // Accumulate small gestures until they survive PDF.js scale rounding.
      pendingWheelDelta = Math.max(-100, Math.min(100, pendingWheelDelta + delta))
      const previousScale = viewer.currentScale
      viewer.updateScale({
        scaleFactor: Math.exp(-pendingWheelDelta / 1000),
        origin: [event.clientX, event.clientY],
        drawingDelay: 100
      })
      if (viewer.currentScale !== previousScale) pendingWheelDelta = 0
    },
    { passive: false, signal: lifetime.signal }
  )
  container.addEventListener(
    'compositionstart',
    () => {
      composing = true
    },
    { signal: lifetime.signal }
  )
  container.addEventListener(
    'compositionend',
    () => {
      composing = false
    },
    { signal: lifetime.signal }
  )
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
    if (
      destroyed ||
      Object.entries(changes).every(
        ([key, value]) => snapshot[key as keyof ViewerSnapshot] === value
      )
    )
      return
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
    onTextEditorChange,
    onError
  })
  const chat = createChatSelection({
    viewer,
    eventBus,
    container,
    signal: lifetime.signal,
    document: () => document,
    annotations: annotations.pageAnnotations,
    release: releasePage,
    onError
  })
  let annotationOptions = initialOptions
  const startPresentation = createPresentationMode(container, viewer, lifetime.signal, (active) => {
    if (active) {
      annotations.commit()
      chat.deactivate()
    }
    annotations.setOptions({ ...annotationOptions, active: !active && annotationOptions.active })
  })
  let searchSnapshot: PdfSearchSnapshot = { current: 0, total: 0, pending: false }
  const updateSearch = ({
    state,
    matchesCount: { current, total }
  }: {
    state?: number
    matchesCount: Pick<PdfSearchSnapshot, 'current' | 'total'>
  }): void => {
    const pending = state === FindState.PENDING
    if (
      destroyed ||
      (current === searchSnapshot.current &&
        total === searchSnapshot.total &&
        pending === searchSnapshot.pending)
    )
      return
    searchSnapshot = { current, total, pending }
    onSearchChange(searchSnapshot)
  }
  eventBus.on('updatefindcontrolstate', updateSearch, { signal: lifetime.signal })
  eventBus.on('updatefindmatchescount', updateSearch, { signal: lifetime.signal })
  eventBus.on(
    'pagesinit',
    () => {
      viewer.pagesRotation = initialView.rotation
      viewer.spreadMode = initialView.twoPageView ? SpreadMode.ODD : SpreadMode.NONE
      viewer.currentPageNumber = Math.max(1, Math.min(initialView.page, viewer.pagesCount))
      viewer.currentScaleValue = initialView.scale || 'page-fit'
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null
        if (initialView.scrollTop > 0) container.scrollTop = initialView.scrollTop
        else viewer.scrollPageIntoView({ pageNumber: viewer.currentPageNumber })
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
  eventBus.on(
    'rotationchanging',
    ({ pagesRotation }: { pagesRotation: number }) => emitSnapshot({ rotation: pagesRotation }),
    { signal: lifetime.signal }
  )
  eventBus.on(
    'spreadmodechanged',
    ({ mode }: { mode: number }) => emitSnapshot({ twoPageView: mode === SpreadMode.ODD }),
    { signal: lifetime.signal }
  )
  const handleScroll = (): void => {
    if (scrollFrame !== null) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null
      emitSnapshot({ scrollTop: container.scrollTop })
    })
  }
  container.addEventListener('scroll', handleScroll, { passive: true, signal: lifetime.signal })
  let containerSize = container.getBoundingClientRect()
  let resizeFrame: number | null = null
  const resizeObserver = new ResizeObserver(() => {
    if (resizeFrame !== null) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null
      const size = container.getBoundingClientRect()
      if (size.width === containerSize.width && size.height === containerSize.height) return
      containerSize = size
      if (destroyed || loading || !container.clientWidth || !container.clientHeight) return
      const scale = viewer.currentScaleValue
      if (scale && Number.isNaN(Number(scale))) viewer.currentScaleValue = scale
      viewer.update()
    })
  })
  resizeObserver.observe(container)

  onLoadingChange(true)
  onPasswordRequest(null)
  const input =
    source.kind === 'memory'
      ? { data: source.data.slice(0) }
      : {
          range: new FileRangeTransport(source, (error) => {
            if (destroyed) return
            loading = false
            onLoadingChange(false)
            onError(error.message)
            void loadingTask.destroy().catch(() => {})
          })
        }
  const loadingTask = getDocument({
    ...input,
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: 16 * 1024
  })
  loadingTask.onPassword = (submit: (password: string) => void, reason: number): void => {
    if (destroyed) return
    onPasswordRequest({
      incorrect: reason === PasswordResponses.INCORRECT_PASSWORD,
      submit: (value) => {
        password = value
        if (!destroyed) submit(value)
      }
    })
  }
  void loadingTask.promise
    .then(async (pdfDocument) => {
      if (destroyed) return
      document = pdfDocument
      const [permissions, signatures] = await Promise.all([
        pdfDocument.getPermissions(),
        pdfDocument.getSignatures()
      ])
      if (destroyed) return
      const signed = Boolean(signatures?.length)
      const canAnnotate =
        !signed && (permissions === null || permissions.has(PermissionFlag.MODIFY_ANNOTATIONS))
      canReorder = !signed && (permissions === null || permissions.has(PermissionFlag.ASSEMBLE))
      emitSnapshot({ pages: pdfDocument.numPages, canAnnotate, signed })
      annotations.setDocument(pdfDocument)
      linkService.setDocument(pdfDocument)
      viewer.setDocument(pdfDocument)
      onDocumentReady(pdfDocument, annotations.pageAnnotations, canReorder)
    })
    .catch((error: unknown) => {
      if (destroyed) return
      loading = false
      onLoadingChange(false)
      onError(error instanceof Error ? error.message : 'The PDF could not be opened.')
    })

  return {
    async extractPages(order) {
      if (destroyed || loading || !document) throw new Error('The PDF is not ready.')
      if (!canReorder) throw new Error('This PDF does not allow page extraction or reordering.')
      validatePageOrder(order, document.numPages)
      annotations.commit()
      const positions = new Map(order.map((original, index) => [original, index]))
      const included = [...order].sort((a, b) => a - b)
      const pageInfo = {
        document: await annotations.save(),
        includePages: included,
        pageIndices: included.map((original) => positions.get(original)!),
        password
      }
      return document.extractPages([pageInfo])
    },
    async print() {
      if (destroyed || loading || !document) return
      await printPdf(async () => {
        annotations.commit()
        return annotations.save()
      }, password)
    },
    async startPresentation() {
      if (destroyed || loading) return
      try {
        await startPresentation()
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Presentation mode could not be started.')
      }
    },
    prepareChatDocument: chat.index,
    selectChatRegion: chat.selectRegion,
    attachSelectedText: chat.selectedText,
    highlightSelectedText: annotations.highlightSelection,
    showCitation: chat.cite,
    releasePageResources: releasePage,
    get revision() {
      return annotations.hash
    },
    search(query, options, previous) {
      if (destroyed) return
      eventBus.dispatch('find', {
        source: findController,
        type: previous === undefined ? '' : 'again',
        query,
        ...options,
        highlightAll: true,
        findPrevious: previous ?? false,
        matchDiacritics: false
      })
    },
    closeSearch() {
      if (!destroyed) eventBus.dispatch('findbarclose', { source: findController })
    },
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
    async snapshotDocument(previousHash) {
      if (destroyed || !document || loading) throw new Error('The PDF is not ready.')
      if (composing) return null
      annotations.commitDraft()
      const hash = annotations.hash
      if (hash === previousHash) return null
      return { hash, data: await annotations.save() }
    },
    async saveDocument() {
      if (destroyed || !document) throw new Error('The PDF is not ready.')
      annotations.commit()
      return annotations.save()
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
    rotateClockwise() {
      if (destroyed || loading) return
      annotations.commit()
      viewer.pagesRotation = (viewer.pagesRotation + 90) % 360
    },
    toggleTwoPageView() {
      if (destroyed || loading) return
      annotations.commit()
      viewer.spreadMode = viewer.spreadMode === SpreadMode.NONE ? SpreadMode.ODD : SpreadMode.NONE
    },
    scrollVertically(direction) {
      if (destroyed || !viewer.pagesCount) return
      scrollKeyboard(0, direction * 40)
    },
    navigateHorizontally(direction) {
      if (destroyed || !viewer.pagesCount) return
      if (container.scrollWidth > container.clientWidth) {
        scrollKeyboard(direction * 40, 0)
      } else {
        viewer.currentPageNumber = Math.min(
          viewer.pagesCount,
          Math.max(1, viewer.currentPageNumber + direction)
        )
      }
    },
    setHighlightColor: annotations.setHighlightColor,
    addImage: annotations.addImage,
    addText: annotations.addText,
    undo: annotations.undo,
    redo: annotations.redo,
    setAnnotationOptions(options) {
      annotationOptions = options
      if (!options.active || options.annotationTool !== 'none') chat.deactivate()
      annotations.setOptions({
        ...options,
        active: options.active && container.ownerDocument.fullscreenElement !== container
      })
    },
    async destroy() {
      if (destroyed) return
      destroyed = true
      resizeObserver.disconnect()
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      lifetime.abort()
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      // @ts-expect-error PDF.js accepts null to detach a document, but its declaration omits it.
      viewer.setDocument(null)
      linkService.setDocument(null)
      document = null
      await loadingTask.destroy()
    }
  }
}
