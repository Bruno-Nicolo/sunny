import { LayoutGrid, Minus, MousePointer2, Plus, Shapes, StickyNote } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { AnnotationToolbar } from '@/features/pdf/annotations/AnnotationToolbar'
import type { AnnotationTool } from '@/features/pdf/annotations/types'
import type { Tab } from '../types'
import './toolbar.css'

type Props = {
  activeTab: Pick<Tab, 'id' | 'view'> | null
  navigationOpen: boolean
  onToggleNavigation(): void
  invertColors: boolean
  annotationTool: AnnotationTool
  onAnnotationToolChange(tool: AnnotationTool): void
  signatureControl: React.ReactNode
  selectionActive: boolean
  onPageChange(page: number): void
  onScaleChange(scale: string): void
  onZoomIn(): void
  onZoomOut(): void
  onRotateClockwise(): void
  onToggleTwoPageView(): void
  onToggleInvertColors(): void
  onStartPresentation(): void
}

import { PdfViewDropdown } from './PdfViewDropdown'

export function DocumentToolbar({
  activeTab,
  navigationOpen,
  onToggleNavigation,
  invertColors,
  annotationTool,
  onAnnotationToolChange,
  signatureControl,
  selectionActive,
  onPageChange,
  onScaleChange,
  onZoomIn,
  onZoomOut,
  onRotateClockwise,
  onToggleTwoPageView,
  onToggleInvertColors,
  onStartPresentation
}: Props): React.JSX.Element | null {
  if (!activeTab) return null

  return (
    <div className="document-toolbar titlebar-no-drag">
      <div className="toolbar-surface" role="group" aria-label="Document controls">
        <ToolbarButton
          label="Toggle PDF navigation"
          tooltip="Open navigation"
          pressed={navigationOpen}
          aria-expanded={navigationOpen}
          aria-haspopup="dialog"
          onClick={onToggleNavigation}
        >
          <LayoutGrid />
        </ToolbarButton>
        <div className="toolbar-navigation" role="group" aria-label="Page navigation">
          <input
            aria-label="Current page"
            inputMode="numeric"
            className="h-8 w-12 rounded-md border bg-transparent px-1 text-center text-sm"
            value={activeTab.view.page}
            onChange={(event) => {
              const page = Number(event.target.value)
              if (Number.isInteger(page) && page >= 1 && page <= activeTab.view.pages)
                onPageChange(page)
            }}
          />
          <span className="text-xs text-muted-foreground">/ {activeTab.view.pages || '—'}</span>
        </div>
        <Separator orientation="vertical" className="data-[orientation=vertical]:h-5" />
        <div className="toolbar-tools" role="toolbar" aria-label="Annotation tools">
          <ToolbarButton
            label="Selection tool"
            tooltip="Select text (Esc)"
            pressed={selectionActive}
            onClick={() => onAnnotationToolChange('none')}
          >
            <MousePointer2 />
          </ToolbarButton>
          <AnnotationToolbar
            key={activeTab.id}
            annotationTool={annotationTool}
            canAnnotate={activeTab.view.canAnnotate}
            signed={activeTab.view.signed}
            onAnnotationToolChange={onAnnotationToolChange}
          />
          <ToolbarButton
            label="Add shapes"
            tooltip="Add shapes (placeholder)"
            aria-disabled="true"
            className="cursor-default text-muted-foreground"
          >
            <Shapes />
          </ToolbarButton>
          <ToolbarButton
            label="Add text note"
            tooltip="Add text note (placeholder)"
            aria-disabled="true"
            className="cursor-default text-muted-foreground"
          >
            <StickyNote />
          </ToolbarButton>
          {signatureControl}
        </div>
        <Separator orientation="vertical" className="data-[orientation=vertical]:h-5" />
        <div className="toolbar-view" role="group" aria-label="Zoom and view">
          <div className="toolbar-zoom" role="group" aria-label="Zoom controls">
            <ToolbarButton label="Zoom out" onClick={onZoomOut}>
              <Minus />
            </ToolbarButton>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-w-16 tabular-nums"
                  aria-label="Zoom level"
                >
                  {activeTab.view.zoomPercent}%
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-44 p-1">
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
            <ToolbarButton label="Zoom in" onClick={onZoomIn}>
              <Plus />
            </ToolbarButton>
          </div>
          <PdfViewDropdown
            align="start"
            disabled={!activeTab.view.pages}
            twoPageView={activeTab.view.twoPageView}
            invertColors={invertColors}
            onRotateClockwise={onRotateClockwise}
            onToggleTwoPageView={onToggleTwoPageView}
            onToggleInvertColors={onToggleInvertColors}
            onStartPresentation={onStartPresentation}
          />
        </div>
      </div>
    </div>
  )
}
