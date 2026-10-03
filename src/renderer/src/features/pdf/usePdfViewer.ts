import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPdfViewer, type PdfViewerController } from './createPdfViewer'
import type { PasswordRequest, PdfDocumentHandle, PdfDocumentViewProps } from './types'

type PdfViewerState = {
  containerRef: RefObject<HTMLDivElement | null>
  viewerElementRef: RefObject<HTMLDivElement | null>
  handle: PdfDocumentHandle
  loading: boolean
  passwordRequest: PasswordRequest | null
  submitPassword(password: string): void
}

export function usePdfViewer(props: PdfDocumentViewProps): PdfViewerState {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerElementRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<PdfViewerController | null>(null)
  const propsRef = useRef(props)
  const [loading, setLoading] = useState(true)
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null)
  useLayoutEffect(() => {
    propsRef.current = props
  }, [props])

  useEffect(() => {
    const container = containerRef.current
    const viewerElement = viewerElementRef.current
    if (!container || !viewerElement) return
    const initial = propsRef.current
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
      onSnapshot: (snapshot) => propsRef.current.onSnapshot(snapshot),
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
      highlightEnabled: props.highlightEnabled,
      highlightColor: props.highlightColor
    })
  }, [props.active, props.highlightEnabled, props.highlightColor])

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
    loading,
    passwordRequest,
    submitPassword(password) {
      if (!password || !passwordRequest) return
      setPasswordRequest(null)
      passwordRequest.submit(password)
    }
  }
}
