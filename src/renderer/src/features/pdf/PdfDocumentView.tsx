import { forwardRef, useImperativeHandle } from 'react'
import 'pdfjs-dist/web/pdf_viewer.css'
import { PasswordDialog } from './PasswordDialog'
import { usePdfViewer } from './usePdfViewer'
import type { PdfDocumentHandle, PdfDocumentViewProps } from './types'

export const PdfDocumentView = forwardRef<PdfDocumentHandle, PdfDocumentViewProps>(
  function PdfDocumentView(props, ref) {
    const { containerRef, viewerElementRef, handle, loading, passwordRequest, submitPassword } =
      usePdfViewer(props)
    useImperativeHandle(ref, () => handle, [handle])
    return (
      <div className="relative h-full min-h-0">
        {loading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background text-sm text-muted-foreground">
            Opening document…
          </div>
        )}
        <div
          ref={containerRef}
          tabIndex={-1}
          className="pdf-viewer-container absolute inset-0 overflow-auto"
        >
          <div ref={viewerElementRef} className="pdfViewer" />
        </div>
        <PasswordDialog
          open={props.active && passwordRequest !== null}
          incorrect={passwordRequest?.incorrect ?? false}
          onSubmit={submitPassword}
        />
      </div>
    )
  }
)
