import type { AnnotationTool, HighlightStyle } from '@/features/pdf/annotations/types'
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
  navigationOpen: boolean
  onNavigationOpenChange: PdfDocumentViewProps['onNavigationOpenChange']
  navigationTab: PdfDocumentViewProps['navigationTab']
  onNavigationTabChange: PdfDocumentViewProps['onNavigationTabChange']
  annotationTool: AnnotationTool
  highlightStyle: HighlightStyle
  highlightFreehandOnly: boolean
  onAskAI: PdfDocumentViewProps['onAskAI']
  onSavePages(id: string, data: Uint8Array, page: number, onSaved: () => void): Promise<boolean>
  onExportPages(id: string, data: Uint8Array): Promise<boolean>
  onPageDraftChange(id: string, dirty: boolean): void
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
  navigationOpen,
  onNavigationOpenChange,
  navigationTab,
  onNavigationTabChange,
  annotationTool,
  highlightStyle,
  highlightFreehandOnly,
  onAskAI,
  onSavePages,
  onExportPages,
  onPageDraftChange,
  onOpen,
  onOpenPath,
  onViewerHandle,
  onDirtyChange,
  onSnapshot,
  onError,
  onTextEditorChange
}: Props): React.JSX.Element {
  return (
    <section className="relative min-h-0 flex-1 bg-sidebar" data-invert-colors={invertColors}>
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
            onSavePages={(data, page, onSaved) => onSavePages(tab.id, data, page, onSaved)}
            onExportPages={(data) => onExportPages(tab.id, data)}
            onPageDraftChange={(dirty) => onPageDraftChange(tab.id, dirty)}
            initialPage={tab.view.page}
            initialScale={tab.view.scale}
            initialScrollTop={tab.view.scrollTop}
            initialRotation={tab.view.rotation}
            initialTwoPageView={tab.view.twoPageView}
            annotationTool={annotationTool}
            highlightStyle={highlightStyle}
            highlightFreehandOnly={highlightFreehandOnly}
            active={tab.id === activeId}
            navigationOpen={navigationOpen}
            onNavigationOpenChange={onNavigationOpenChange}
            navigationTab={navigationTab}
            onNavigationTabChange={onNavigationTabChange}
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
