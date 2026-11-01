import type { AnnotationTool } from '@/features/pdf/annotations/types'
import type { TextEditorSettings } from '@/features/pdf/annotations/text/types'
import { WelcomeScreen } from './WelcomeScreen'
import { PdfDocumentView } from '@/features/pdf/PdfDocumentView'
import type { PdfDocumentHandle, PdfDocumentViewProps, ViewerSnapshot } from '@/features/pdf/types'
import { cn } from '@/lib/utils'
import type { Tab } from '../types'

type Props = {
  tabs: Tab[]
  activeId: string | null
  ready: boolean
  invertColors: boolean
  sidebarOpen: boolean
  sidebarTab: PdfDocumentViewProps['sidebarTab']
  onSidebarTabChange: PdfDocumentViewProps['onSidebarTabChange']
  annotationTool: AnnotationTool
  highlightColor: string
  onAskAI: PdfDocumentViewProps['onAskAI']
  onOpen(): void
  onOpenPath(path: string): Promise<void>
  onViewerHandle(id: string, handle: PdfDocumentHandle | null): void
  onDirtyChange(id: string, dirty: boolean): void
  onSnapshot(id: string, view: ViewerSnapshot): void
  onError(id: string, error: string): void
  onTextEditorChange(id: string, settings: TextEditorSettings | null): void
}

export function DocumentWorkspace({
  tabs,
  activeId,
  ready,
  invertColors,
  sidebarOpen,
  sidebarTab,
  onSidebarTabChange,
  annotationTool,
  highlightColor,
  onAskAI,
  onOpen,
  onOpenPath,
  onViewerHandle,
  onDirtyChange,
  onSnapshot,
  onError,
  onTextEditorChange
}: Props): React.JSX.Element {
  return (
    <section className="relative min-h-0 flex-1 bg-muted/45" data-invert-colors={invertColors}>
      {tabs.length === 0 && ready && <WelcomeScreen onOpen={onOpen} onOpenPath={onOpenPath} />}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn('absolute inset-0', tab.id === activeId ? 'visible' : 'invisible')}
        >
          <PdfDocumentView
            ref={(handle) => onViewerHandle(tab.id, handle)}
            canAnnotate={tab.view.canAnnotate}
            onAskAI={onAskAI}
            source={tab.source}
            initialPage={tab.view.page}
            initialScale={tab.view.scale}
            initialScrollTop={tab.view.scrollTop}
            initialRotation={tab.view.rotation}
            initialTwoPageView={tab.view.twoPageView}
            annotationTool={annotationTool}
            highlightColor={highlightColor}
            active={tab.id === activeId}
            sidebarOpen={sidebarOpen}
            sidebarTab={sidebarTab}
            onSidebarTabChange={onSidebarTabChange}
            onDirtyChange={(dirty) => onDirtyChange(tab.id, dirty)}
            onSnapshot={(view) => onSnapshot(tab.id, view)}
            onError={(error) => onError(tab.id, error)}
            onTextEditorChange={(settings) => onTextEditorChange(tab.id, settings)}
          />
        </div>
      ))}
    </section>
  )
}
