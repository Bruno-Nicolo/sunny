import { FileText } from 'lucide-react'
import type { AnnotationTool } from '@/features/pdf/annotations/types'
import { Button } from '@/components/ui/button'
import { PdfDocumentView } from '@/features/pdf/PdfDocumentView'
import type { PdfDocumentHandle, ViewerSnapshot } from '@/features/pdf/types'
import { cn } from '@/lib/utils'
import type { Tab } from '../types'

type Props = {
  tabs: Tab[]
  activeId: string | null
  ready: boolean
  sidebarOpen: boolean
  annotationTool: AnnotationTool
  highlightColor: string
  onOpen(): void
  onViewerHandle(id: string, handle: PdfDocumentHandle | null): void
  onDirtyChange(id: string, dirty: boolean): void
  onSnapshot(id: string, view: ViewerSnapshot): void
  onError(id: string, error: string): void
}

export function DocumentWorkspace({
  tabs,
  activeId,
  ready,
  sidebarOpen,
  annotationTool,
  highlightColor,
  onOpen,
  onViewerHandle,
  onDirtyChange,
  onSnapshot,
  onError
}: Props): React.JSX.Element {
  return (
    <section className="relative min-h-0 flex-1 bg-muted/45">
      {tabs.length === 0 && ready && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="grid size-14 place-items-center rounded-2xl border bg-background shadow-sm">
              <FileText className="size-6 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Open a PDF</h1>
              <p className="mt-1 text-sm text-muted-foreground">Drop a document here or press ⌘O</p>
            </div>
            <Button onClick={onOpen}>Open PDF</Button>
          </div>
        </div>
      )}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn('absolute inset-0', tab.id === activeId ? 'visible' : 'invisible')}
        >
          <PdfDocumentView
            ref={(handle) => onViewerHandle(tab.id, handle)}
            data={tab.data}
            initialPage={tab.view.page}
            initialScale={tab.view.scale}
            initialScrollTop={tab.view.scrollTop}
            annotationTool={annotationTool}
            highlightColor={highlightColor}
            active={tab.id === activeId}
            sidebarOpen={sidebarOpen}
            onDirtyChange={(dirty) => onDirtyChange(tab.id, dirty)}
            onSnapshot={(view) => onSnapshot(tab.id, view)}
            onError={(error) => onError(tab.id, error)}
          />
        </div>
      ))}
    </section>
  )
}
