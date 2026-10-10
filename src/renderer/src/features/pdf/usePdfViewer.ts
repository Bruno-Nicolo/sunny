import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPdfViewer, type PdfViewerController } from './createPdfViewer'
import type {
  PasswordRequest,
  PdfDocumentHandle,
  PdfDocumentViewProps,
  TextEditorSettings
} from './types'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

type PdfViewerState = {
  containerRef: RefObject<HTMLDivElement | null>
  viewerElementRef: RefObject<HTMLDivElement | null>
  handle: PdfDocumentHandle
  textEditor: TextEditorSettings | null
  loading: boolean
  document: PDFDocumentProxy | null
  page: number
  navigateToDestination(destination: string | unknown[]): Promise<void>
  passwordRequest: PasswordRequest | null
  submitPassword(password: string): void
}

export function usePdfViewer(props: PdfDocumentViewProps): PdfViewerState {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerElementRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<PdfViewerController | null>(null)
  const propsRef = useRef(props)
  const [textEditor, setTextEditor] = useState<TextEditorSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(props.initialPage)
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null)
  useLayoutEffect(() => {
    propsRef.current = props
  }, [props])

  useEffect(() => {
    const container = containerRef.current
    const viewerElement = viewerElementRef.current
    if (!container || !viewerElement) return
    const initial = propsRef.current
    setDocument(null)
    setTextEditor(null)
    const controller = createPdfViewer({
      container,
      viewerElement,
      data: props.data,
      initialView: {
        page: initial.initialPage,
        scale: initial.initialScale,
        scrollTop: initial.initialScrollTop
      },
      annotationOptions: initial,
      onSnapshot: (snapshot) => {
        setPage(snapshot.page)
        propsRef.current.onSnapshot(snapshot)
      },
      onDocumentReady: setDocument,
      onTextEditorChange: setTextEditor,
      onDirtyChange: (dirty) => propsRef.current.onDirtyChange(dirty),
      onError: (message) => propsRef.current.onError(message),
      onLoadingChange: setLoading,
      onPasswordRequest: setPasswordRequest
    })
    controllerRef.current = controller
    return () => {
      controllerRef.current = null
      void controller.destroy().catch((error: unknown) => {
        console.error('The PDF viewer could not be released.', error)
      })
    }
  }, [props.data])

  useEffect(() => {
    controllerRef.current?.setAnnotationOptions({
      active: props.active,
      annotationTool: props.annotationTool,
      highlightColor: props.highlightColor
    })
  }, [props.active, props.annotationTool, props.highlightColor])

  const handle = useMemo<PdfDocumentHandle>(
    () => ({
      async saveDocument() {
        if (!controllerRef.current) throw new Error('The PDF is not ready.')
        return controllerRef.current.saveDocument()
      },
      setPage: (page) => controllerRef.current?.setPage(page),
      setScale: (scale) => controllerRef.current?.setScale(scale),
      zoomIn: () => controllerRef.current?.zoomIn(),
      zoomOut: () => controllerRef.current?.zoomOut(),
      navigateHorizontally: (direction) => controllerRef.current?.navigateHorizontally(direction),
      async addImage(file) {
        if (!controllerRef.current) throw new Error('This PDF is not ready for editing.')
        await controllerRef.current.addImage(file)
      },
      undo: () => controllerRef.current?.undo(),
      redo: () => controllerRef.current?.redo()
    }),
    []
  )

  return {
    containerRef,
    viewerElementRef,
    handle,
    textEditor,
    loading,
    document,
    page,
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
