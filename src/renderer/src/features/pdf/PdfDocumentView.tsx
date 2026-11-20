import { forwardRef, useImperativeHandle, useRef } from 'react'
import 'pdfjs-dist/web/pdf_viewer.css'
import './annotations/annotations.css'
import { PasswordDialog } from './PasswordDialog'
import { usePdfViewer } from './usePdfViewer'
import type { PdfDocumentHandle, PdfDocumentViewProps } from './types'
import { PdfNavigationDialog, type NavigationHandle } from './PdfNavigationDialog'
import { PdfSearchInput } from './PdfSearchInput'
import { TextSelectionPopover } from './TextSelectionPopover'

export const PdfDocumentView = forwardRef<PdfDocumentHandle, PdfDocumentViewProps>(
  function PdfDocumentView(props, ref) {
    const {
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
      navigateToDestination,
      extractPages,
      passwordRequest,
      submitPassword
    } = usePdfViewer(props)
    const navigationRef = useRef<NavigationHandle>(null)
    useImperativeHandle(
      ref,
      () => ({
        ...handle,
        get revision() {
          return handle.revision
        },
        confirmPageChanges: async () => navigationRef.current?.confirmLeave() ?? true,
        preparePageChanges: async () => navigationRef.current?.prepareChanges() ?? null
      }),
      [handle]
    )
    return (
      <div className="relative flex h-full min-h-0 flex-col">
        {loading && props.active && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background text-sm text-muted-foreground">
            Opening document…
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {document && props.active && (
            <PdfNavigationDialog
              key={document.pdf.loadingTask.docId}
              ref={navigationRef}
              open={props.navigationOpen}
              onOpenChange={props.onNavigationOpenChange}
              document={document.pdf}
              annotations={document.annotations}
              tab={props.navigationTab}
              onTabChange={props.onNavigationTabChange}
              page={page}
              onPage={handle.setPage}
              onExtractPages={extractPages}
              onSavePages={props.onSavePages}
              onExportPages={props.onExportPages}
              onPageDraftChange={props.onPageDraftChange}
              canReorder={document.canReorder}
              onReleasePage={releasePageResources}
              onDestination={navigateToDestination}
              onError={props.onError}
            />
          )}
          <div className="relative min-w-0 flex-1">
            {props.active && props.annotationTool === 'none' && !loading && (
              <TextSelectionPopover
                containerRef={containerRef}
                canAnnotate={props.canAnnotate}
                handle={handle}
                onAskAI={props.onAskAI}
              />
            )}
            <PdfSearchInput
              active={props.active}
              request={searchRequest}
              snapshot={searchSnapshot}
              onSearch={search}
              onClose={closeSearch}
            />
            <div
              ref={containerRef}
              tabIndex={-1}
              className="pdf-viewer-container absolute inset-0 isolate overflow-auto focus:outline-none"
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
      </div>
    )
  }
)
