import type { TextEditorSettings } from './annotations/text/types'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from 'react'
import type { PdfViewerController } from './createPdfViewer'
import type {
  PasswordRequest,
  PdfDocumentHandle,
  PdfDocumentViewProps,
  PdfSearchSnapshot
} from './types'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

type PdfViewerState = {
  containerRef: RefObject<HTMLDivElement | null>
  viewerElementRef: RefObject<HTMLDivElement | null>
  handle: PdfDocumentHandle
  loading: boolean
  document: PDFDocumentProxy | null
  page: number
  searchSnapshot: PdfSearchSnapshot
  searchRequest: number | null
  search: PdfViewerController['search']
  closeSearch(): void
  releasePageResources(page: PDFPageProxy): void
  navigateToDestination(destination: string | unknown[]): Promise<void>
  passwordRequest: PasswordRequest | null
  submitPassword(password: string): void
}

export function usePdfViewer(props: PdfDocumentViewProps): PdfViewerState {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerElementRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<PdfViewerController | null>(null)
  const propsRef = useRef(props)
  const sourceRevision = useRef('')
  const sourceMounted = useRef(false)
  const [activated, setActivated] = useState(props.active)
  if (props.active && !activated) setActivated(true)
  const [textEditor, setTextEditor] = useState<TextEditorSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(props.initialPage)
  const [searchSnapshot, setSearchSnapshot] = useState<PdfSearchSnapshot>({
    current: 0,
    total: 0,
    pending: false
  })
  const [searchRequest, setSearchRequest] = useState<number | null>(null)
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null)
  useLayoutEffect(() => {
    if (!sourceRevision.current || propsRef.current.source !== props.source)
      sourceRevision.current = crypto.randomUUID()
    propsRef.current = props
  }, [props])

  useEffect(() => {
    const container = containerRef.current
    const viewerElement = viewerElementRef.current
    if (!activated || !container || !viewerElement) return
    const initial = propsRef.current
    setDocument(null)
    setTextEditor(null)
    setSearchRequest(null)
    setSearchSnapshot({ current: 0, total: 0, pending: false })
    let cancelled = false
    let controller: PdfViewerController | null = null
    void import('./createPdfViewer')
      .then(({ createPdfViewer }) => {
        if (cancelled) return
        controller = createPdfViewer({
          container,
          viewerElement,
          source: props.source,
          initialView: {
            page: initial.initialPage,
            scale: initial.initialScale,
            scrollTop: initial.initialScrollTop,
            rotation: initial.initialRotation,
            twoPageView: initial.initialTwoPageView
          },
          annotationOptions: propsRef.current,
          onSnapshot: (snapshot) => {
            setPage(snapshot.page)
            propsRef.current.onSnapshot(snapshot)
          },
          onDocumentReady: setDocument,
          onTextEditorChange: setTextEditor,
          onSearchChange: setSearchSnapshot,
          onDirtyChange: (dirty) => propsRef.current.onDirtyChange(dirty),
          onError: (message) => propsRef.current.onError(message),
          onLoadingChange: setLoading,
          onPasswordRequest: setPasswordRequest
        })
        controllerRef.current = controller
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoading(false)
        propsRef.current.onError(
          error instanceof Error ? error.message : 'The PDF viewer could not be loaded.'
        )
      })
    return () => {
      cancelled = true
      propsRef.current.onTextEditorChange(null)
      controllerRef.current = null
      void controller?.destroy().catch((error: unknown) => {
        console.error('The PDF viewer could not be released.', error)
      })
    }
  }, [props.source, activated])

  useEffect(() => {
    const source = props.source
    sourceMounted.current = true
    return () => {
      sourceMounted.current = false
      // StrictMode immediately remounts this source; real unmounts and replacements release it.
      queueMicrotask(() => {
        const next = propsRef.current.source
        if (
          source.kind === 'file' &&
          (!sourceMounted.current || next.kind !== 'file' || next.url !== source.url)
        )
          void window.lepis
            .releasePdfSource(source)
            .catch((error) => console.error('The PDF source could not be released.', error))
      })
    }
  }, [props.source])

  useEffect(() => {
    controllerRef.current?.setAnnotationOptions({
      active: props.active,
      annotationTool: props.annotationTool,
      highlightColor: props.highlightColor
    })
  }, [props.active, props.annotationTool, props.highlightColor])

  useEffect(() => {
    if (props.active) propsRef.current.onTextEditorChange(textEditor)
  }, [props.active, textEditor])

  const handle = useMemo<PdfDocumentHandle>(
    () => ({
      get revision() {
        return controllerRef.current?.revision ?? sourceRevision.current
      },
      openSearch() {
        setSearchRequest((request) => (request ?? 0) + 1)
      },
      async snapshotDocument(previousHash) {
        if (!controllerRef.current) return null
        return controllerRef.current.snapshotDocument(previousHash)
      },
      async saveDocument() {
        // Unopened recovery PDFs already contain their serialized annotations.
        if (!controllerRef.current) {
          const source = propsRef.current.source
          if (source.kind === 'memory') return new Uint8Array(source.data.slice(0))
          throw new Error('The PDF is not ready.')
        }
        return controllerRef.current.saveDocument()
      },
      setPage: (page) => controllerRef.current?.setPage(page),
      setScale: (scale) => controllerRef.current?.setScale(scale),
      zoomIn: () => controllerRef.current?.zoomIn(),
      zoomOut: () => controllerRef.current?.zoomOut(),
      rotateClockwise: () => controllerRef.current?.rotateClockwise(),
      toggleTwoPageView: () => controllerRef.current?.toggleTwoPageView(),
      navigateHorizontally: (direction) => controllerRef.current?.navigateHorizontally(direction),
      scrollVertically: (direction) => controllerRef.current?.scrollVertically(direction),
      setHighlightColor: (color) => controllerRef.current?.setHighlightColor(color),
      async addImage(file) {
        if (!controllerRef.current) throw new Error('This PDF is not ready for editing.')
        await controllerRef.current.addImage(file)
      },
      undo: () => controllerRef.current?.undo(),
      redo: () => controllerRef.current?.redo()
    }),
    []
  )

  const releasePageResources = useCallback((page: PDFPageProxy): void => {
    controllerRef.current?.releasePageResources(page)
  }, [])

  const search = useCallback<PdfViewerController['search']>((query, options, previous) => {
    controllerRef.current?.search(query, options, previous)
  }, [])
  const closeSearch = useCallback((): void => {
    controllerRef.current?.closeSearch()
    setSearchRequest(null)
    containerRef.current?.focus({ preventScroll: true })
  }, [])

  return {
    containerRef,
    viewerElementRef,
    handle,
    loading,
    document,
    page,
    searchSnapshot,
    searchRequest,
    search,
    closeSearch,
    releasePageResources,
    async navigateToDestination(destination) {
      await controllerRef.current?.navigateToDestination(destination)
    },
    passwordRequest,
    submitPassword(password) {
      if (!password || !passwordRequest) return
      setPasswordRequest(null)
      passwordRequest.submit(password)
    }
  }
}
