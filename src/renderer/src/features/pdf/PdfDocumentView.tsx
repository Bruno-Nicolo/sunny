import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  GlobalWorkerOptions,
  PasswordResponses,
  PermissionFlag,
  getDocument,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const HIGHLIGHT_COLORS = 'yellow=#FDE047,green=#86EFAC,blue=#7DD3FC,pink=#F9A8D4'

export type ViewerSnapshot = {
  page: number
  pages: number
  scale: string
  zoomPercent: number
  scrollTop: number
  canAnnotate: boolean
  signed: boolean
}

export type PdfDocumentHandle = {
  saveDocument(): Promise<Uint8Array>
  setPage(page: number): void
  setScale(scale: string): void
  zoomIn(): void
  zoomOut(): void
  navigateHorizontally(direction: -1 | 1): void
  setHighlightMode(enabled: boolean): void
  setHighlightColor(color: string): void
  undo(): void
  redo(): void
}

type Props = {
  data: Uint8Array
  initialPage: number
  initialScale: string
  initialScrollTop: number
  highlightEnabled: boolean
  highlightColor: string
  onDirtyChange(dirty: boolean): void
  onSnapshot(snapshot: ViewerSnapshot): void
  onError(message: string): void
}

type ViewerInternals = PDFViewer & {
  _layerProperties: {
    annotationEditorUIManager?: {
      undo(): void
      redo(): void
    }
  }
}

function containsDigitalSignature(data: Uint8Array): boolean {
  const decoder = new TextDecoder('latin1')
  const chunkSize = 64 * 1024
  let hasByteRange = false
  let hasSignatureType = false
  for (
    let offset = 0;
    offset < data.length && !(hasByteRange && hasSignatureType);
    offset += chunkSize
  ) {
    const sample = decoder.decode(data.subarray(Math.max(0, offset - 128), offset + chunkSize))
    hasByteRange ||= /\/ByteRange\s*\[/.test(sample)
    hasSignatureType ||= /\/(?:FT|Type)\s*\/Sig\b/.test(sample)
  }
  return hasByteRange && hasSignatureType
}

export const PdfDocumentView = forwardRef<PdfDocumentHandle, Props>(function PdfDocumentView(
  {
    data,
    initialPage,
    initialScale,
    initialScrollTop,
    highlightEnabled,
    highlightColor,
    onDirtyChange,
    onSnapshot,
    onError
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerElementRef = useRef<HTMLDivElement>(null)
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const documentRef = useRef<PDFDocumentProxy | null>(null)
  const viewerRef = useRef<ViewerInternals | null>(null)
  const eventBusRef = useRef<EventBus | null>(null)
  const initialViewRef = useRef({ initialPage, initialScale, initialScrollTop })
  const callbacksRef = useRef({ onDirtyChange, onSnapshot, onError })
  const snapshotRef = useRef<ViewerSnapshot>({
    page: initialPage,
    pages: 0,
    scale: initialScale,
    zoomPercent: 100,
    scrollTop: initialScrollTop,
    canAnnotate: false,
    signed: false
  })
  const passwordCallbackRef = useRef<((password: string) => void) | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordIncorrect, setPasswordIncorrect] = useState(false)
  const [loading, setLoading] = useState(true)

  const emitSnapshot = useCallback((changes: Partial<ViewerSnapshot>): void => {
    snapshotRef.current = { ...snapshotRef.current, ...changes }
    callbacksRef.current.onSnapshot(snapshotRef.current)
  }, [])

  useEffect(() => {
    callbacksRef.current = { onDirtyChange, onSnapshot, onError }
  }, [onDirtyChange, onError, onSnapshot])

  useImperativeHandle(ref, () => ({
    async saveDocument() {
      if (!documentRef.current) throw new Error('The PDF is not ready.')
      return documentRef.current.saveDocument()
    },
    setPage(page) {
      if (viewerRef.current) viewerRef.current.currentPageNumber = page
    },
    setScale(scale) {
      if (viewerRef.current) viewerRef.current.currentScaleValue = scale
    },
    zoomIn() {
      viewerRef.current?.increaseScale()
    },
    zoomOut() {
      viewerRef.current?.decreaseScale()
    },
    navigateHorizontally(direction) {
      const container = containerRef.current
      const viewer = viewerRef.current
      if (!container || !viewer || !viewer.pagesCount) return
      if (container.scrollWidth > container.clientWidth) {
        container.scrollBy({ left: direction * 40, behavior: 'smooth' })
        return
      }
      viewer.currentPageNumber = Math.min(
        viewer.pagesCount,
        Math.max(1, viewer.currentPageNumber + direction)
      )
    },
    setHighlightMode(enabled) {
      const viewer = viewerRef.current
      if (!viewer || !snapshotRef.current.canAnnotate) return
      viewer.annotationEditorMode = {
        mode: enabled ? AnnotationEditorType.HIGHLIGHT : AnnotationEditorType.NONE
      }
    },
    setHighlightColor(color) {
      eventBusRef.current?.dispatch('switchannotationeditorparams', {
        source: null,
        type: AnnotationEditorParamsType.HIGHLIGHT_COLOR,
        value: color
      })
    },
    undo() {
      viewerRef.current?._layerProperties.annotationEditorUIManager?.undo()
    },
    redo() {
      viewerRef.current?._layerProperties.annotationEditorUIManager?.redo()
    }
  }))

  useEffect(() => {
    const container = containerRef.current
    const viewerElement = viewerElementRef.current
    if (!container || !viewerElement) return
    const initialView = initialViewRef.current

    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const viewer = new PDFViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      annotationEditorMode: AnnotationEditorType.NONE,
      annotationEditorHighlightColors: HIGHLIGHT_COLORS,
      enablePermissions: true,
      supportsPinchToZoom: true,
      removePageBorders: true
    }) as ViewerInternals
    linkService.setViewer(viewer)
    viewerRef.current = viewer
    eventBusRef.current = eventBus

    eventBus.on('pagesinit', () => {
      viewer.currentPageNumber = Math.max(1, Math.min(initialView.initialPage, viewer.pagesCount))
      viewer.currentScaleValue = initialView.initialScale || 'page-width'
      requestAnimationFrame(() => {
        container.scrollTop = initialView.initialScrollTop
      })
      emitSnapshot({
        page: viewer.currentPageNumber,
        pages: viewer.pagesCount,
        scale: viewer.currentScaleValue,
        zoomPercent: Math.round(viewer.currentScale * 100)
      })
      setLoading(false)
    })
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      emitSnapshot({ page: pageNumber })
    })
    eventBus.on(
      'scalechanging',
      ({ scale, presetValue }: { scale: number; presetValue?: string }) => {
        emitSnapshot({
          scale: presetValue || String(scale),
          zoomPercent: Math.round(scale * 100)
        })
      }
    )
    const handleScroll = (): void => emitSnapshot({ scrollTop: container.scrollTop })
    container.addEventListener('scroll', handleScroll, { passive: true })

    const loadingTask = getDocument({ data: data.slice() })
    loadingTaskRef.current = loadingTask
    loadingTask.onPassword = (updatePassword, reason) => {
      passwordCallbackRef.current = updatePassword
      setPasswordIncorrect(reason === PasswordResponses.INCORRECT_PASSWORD)
      setPasswordOpen(true)
    }

    void loadingTask.promise
      .then(async (pdfDocument) => {
        documentRef.current = pdfDocument
        const [permissions] = await Promise.all([pdfDocument.getPermissions()])
        const signed = containsDigitalSignature(data)
        const canAnnotate =
          !signed && (permissions === null || permissions.has(PermissionFlag.MODIFY_ANNOTATIONS))
        emitSnapshot({ pages: pdfDocument.numPages, canAnnotate, signed })

        ;(
          pdfDocument.annotationStorage as unknown as {
            onSetModified: (() => void) | null
          }
        ).onSetModified = () => callbacksRef.current.onDirtyChange(true)
        linkService.setDocument(pdfDocument)
        viewer.setDocument(pdfDocument)
      })
      .catch((error: unknown) => {
        setLoading(false)
        callbacksRef.current.onError(
          error instanceof Error ? error.message : 'The PDF could not be opened.'
        )
      })

    return () => {
      container.removeEventListener('scroll', handleScroll)
      viewer.cleanup()
      void loadingTask.destroy()
      viewerRef.current = null
      documentRef.current = null
      eventBusRef.current = null
    }
  }, [data, emitSnapshot])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !snapshotRef.current.canAnnotate) return
    viewer.annotationEditorMode = {
      mode: highlightEnabled ? AnnotationEditorType.HIGHLIGHT : AnnotationEditorType.NONE
    }
  }, [highlightEnabled])

  useEffect(() => {
    eventBusRef.current?.dispatch('switchannotationeditorparams', {
      source: null,
      type: AnnotationEditorParamsType.HIGHLIGHT_COLOR,
      value: highlightColor
    })
  }, [highlightColor])

  const submitPassword = (): void => {
    if (!password) return
    passwordCallbackRef.current?.(password)
    setPassword('')
    setPasswordOpen(false)
  }

  return (
    <div className="relative h-full min-h-0">
      {loading && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background text-sm text-muted-foreground">
          Opening document…
        </div>
      )}
      <div ref={containerRef} className="pdf-viewer-container absolute inset-0 overflow-auto">
        <div ref={viewerElementRef} className="pdfViewer" />
      </div>

      <Dialog open={passwordOpen} onOpenChange={() => undefined}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Password required</DialogTitle>
            <DialogDescription>
              {passwordIncorrect
                ? 'The password was incorrect. Try again.'
                : 'This PDF is protected. Enter its password to open it.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submitPassword()
            }}
          >
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              aria-label="PDF password"
            />
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={!password}>
                Open
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
})
