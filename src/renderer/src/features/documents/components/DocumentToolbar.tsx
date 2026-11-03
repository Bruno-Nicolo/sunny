import { LayoutGrid, Minus, Plus } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { AnnotationToolbar } from '@/features/pdf/annotations/AnnotationToolbar'
import type { AnnotationTool } from '@/features/pdf/annotations/types'
import type { TextEditorSettings } from '@/features/pdf/annotations/text/types'
import type { Tab } from '../types'
import { PdfViewDropdown } from './PdfViewDropdown'

type Props = {
  activeTab: Pick<Tab, 'id' | 'view'> | null
  navigationOpen: boolean
  onToggleNavigation(): void
  invertColors: boolean
  annotationTool: AnnotationTool
  highlightColor: string
  textSettings: TextEditorSettings | null
  onAnnotationToolChange(tool: AnnotationTool): void
  onHighlightColorChange(color: string): void
  onAddImages(files: File[]): void
  onPageChange(page: number): void
  onScaleChange(scale: string): void
  onZoomIn(): void
  onZoomOut(): void
  onRotateClockwise(): void
  onToggleTwoPageView(): void
  onToggleInvertColors(): void
  onStartPresentation(): void
}

export function DocumentToolbar({
  activeTab,
  navigationOpen,
  onToggleNavigation,
  invertColors,
  annotationTool,
  highlightColor,
  textSettings,
  onAnnotationToolChange,
  onHighlightColorChange,
  onAddImages,
  onPageChange,
  onScaleChange,
  onZoomIn,
  onZoomOut,
  onRotateClockwise,
  onToggleTwoPageView,
  onToggleInvertColors,
  onStartPresentation
}: Props): React.JSX.Element {
  return (
    <div className="titlebar-no-drag flex h-11 items-center justify-center gap-1 bg-background px-3">
      {activeTab && (
        <>
          <ToolbarButton
            label="Toggle PDF navigation"
            tooltip="Open navigation"
            aria-expanded={navigationOpen}
            aria-haspopup="dialog"
            onClick={onToggleNavigation}
          >
            <LayoutGrid />
          </ToolbarButton>
          <div className="flex items-center gap-1">
            <input
              aria-label="Current page"
              className="h-8 w-12 rounded-md border bg-transparent px-1 text-center text-sm"
              value={activeTab.view.page}
              onChange={(event) => {
                const page = Number(event.target.value)
                if (Number.isInteger(page) && page >= 1 && page <= activeTab.view.pages) {
                  onPageChange(page)
                }
              }}
            />
            <span className="text-xs text-muted-foreground">/ {activeTab.view.pages || '—'}</span>
          </div>
          <Separator orientation="vertical" className="mx-3.5 data-[orientation=vertical]:h-5" />
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={onZoomOut}>
              <Minus />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="min-w-16">
                  {activeTab.view.zoomPercent}%
                </Button>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-44 p-1">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => onScaleChange('page-width')}
                >
                  Fit width
                </Button>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => onScaleChange('page-fit')}
                >
                  Fit page
                </Button>
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="icon-sm" onClick={onZoomIn}>
              <Plus />
            </Button>
          </div>
          <PdfViewDropdown
            disabled={!activeTab.view.pages}
            twoPageView={activeTab.view.twoPageView}
            invertColors={invertColors}
            onRotateClockwise={onRotateClockwise}
            onToggleTwoPageView={onToggleTwoPageView}
            onToggleInvertColors={onToggleInvertColors}
            onStartPresentation={onStartPresentation}
          />
          <Separator orientation="vertical" className="mx-3.5 data-[orientation=vertical]:h-5" />
        </>
      )}
      <AnnotationToolbar
        key={activeTab?.id}
        annotationTool={annotationTool}
        highlightColor={highlightColor}
        textSettings={textSettings}
        canAnnotate={activeTab?.view.canAnnotate ?? false}
        signed={activeTab?.view.signed ?? false}
        onAnnotationToolChange={onAnnotationToolChange}
        onHighlightColorChange={onHighlightColorChange}
        onAddImages={onAddImages}
      />
    </div>
  )
}
