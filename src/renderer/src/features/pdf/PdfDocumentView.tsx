import { forwardRef, useImperativeHandle } from 'react'
import { SidebarProvider } from '@/components/ui/sidebar'
import 'pdfjs-dist/web/pdf_viewer.css'
import { PasswordDialog } from './PasswordDialog'
import { usePdfViewer } from './usePdfViewer'
import type { PdfDocumentHandle, PdfDocumentViewProps } from './types'
import { PdfSidebar } from './PdfSidebar'

export const PdfDocumentView = forwardRef<PdfDocumentHandle, PdfDocumentViewProps>(
  function PdfDocumentView(props, ref) {
    const {
      containerRef,
      viewerElementRef,
      handle,
      loading,
      document,
      page,
      navigateToDestination,
      passwordRequest,
      submitPassword
    } = usePdfViewer(props)
    useImperativeHandle(ref, () => handle, [handle])
    return (
      <SidebarProvider open={props.sidebarOpen} className="relative h-full min-h-0 flex-col">
        {loading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background text-sm text-muted-foreground">
            Opening document…
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {document && props.sidebarOpen && (
            <PdfSidebar
              document={document}
              page={page}
              active={props.active}
              onPage={handle.setPage}
              onDestination={navigateToDestination}
              onError={props.onError}
            />
          )}
          <div className="relative min-w-0 flex-1">
            <div
              ref={containerRef}
              tabIndex={-1}
              className="pdf-viewer-container absolute inset-0 overflow-auto"
            >
              <div ref={viewerElementRef} className="pdfViewer" />
            </div>
          </div>
        </div>
        <PasswordDialog
          open={props.active && passwordRequest !== null}
          incorrect={passwordRequest?.incorrect ?? false}
          onSubmit={submitPassword}
        />
      </SidebarProvider>
    )
  }
)
