import { useLayoutEffect, useRef, useState } from 'react'
import { LayoutGrid, Minus, MousePointer2, Plus, Shapes, StickyNote } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { AnnotationToolbar } from '@/features/pdf/annotations/AnnotationToolbar'
import type { AnnotationTool } from '@/features/pdf/annotations/types'
import type { Tab } from '../types'
import { PdfViewDropdown } from './PdfViewDropdown'
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

function PageNumberInput({
  page,
  pages,
  onPageChange
}: {
  page: number
  pages: number
  onPageChange: Props['onPageChange']
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <input
      aria-label="Current page"
      inputMode="numeric"
      className="h-8 w-12 rounded-md border bg-transparent px-1 text-center text-sm"
      value={draft ?? page}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => setDraft(null)}
      onKeyDown={({ key, nativeEvent, currentTarget }) => {
        if (key !== 'Enter' || nativeEvent.isComposing) return
        const value = currentTarget.value
        const target = Number(value)
        if (/^\d+$/.test(value) && target >= 1 && target <= pages && target !== page)
          onPageChange(target)
        setDraft(null)
      }}
    />
  )
}

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
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [zoomOpen, setZoomOpen] = useState(false)
  const pageCount = activeTab?.view.pages
  const tabId = activeTab?.id

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    const canvas = surface?.closest<HTMLElement>('.document-canvas')
    if (!surface || !canvas) return

    const style = getComputedStyle(canvas)
    const searchWidth = parseFloat(style.getPropertyValue('--pdf-search-width'))
    const searchHeight = parseFloat(style.getPropertyValue('--pdf-search-height'))
    const searchInset = parseFloat(style.getPropertyValue('--pdf-search-inset'))
    const gap = 8
    const updateLayout = (): void => {
      if (!canvas.clientWidth) return
      surface.removeAttribute('data-compact')
      const compact = surface.scrollWidth > surface.clientWidth
      surface.toggleAttribute('data-compact', compact)
      if (compact) setZoomOpen(false)

      const freeSpace = (canvas.clientWidth - surface.offsetWidth) / 2
      const searchTop =
        freeSpace >= searchWidth + searchInset + gap
          ? surface.offsetTop + (surface.offsetHeight - searchHeight) / 2
          : surface.offsetTop + surface.offsetHeight + gap
      canvas.style.setProperty('--pdf-search-top', `${searchTop}px`)
    }

    updateLayout()
    const observer = new ResizeObserver(updateLayout)
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      canvas.style.removeProperty('--pdf-search-top')
    }
  }, [pageCount, tabId])

  if (!activeTab) return null

  return (
    <div className="document-toolbar titlebar-no-drag">
      <div ref={surfaceRef} className="toolbar-surface" role="group" aria-label="Document controls">
        <ToolbarButton
          label="Toggle PDF navigation"
          tooltip="Open navigation"
          pressed={navigationOpen}
          variant={navigationOpen ? 'secondary' : 'ghost'}
          aria-expanded={navigationOpen}
          aria-haspopup="dialog"
          onClick={onToggleNavigation}
        >
          <LayoutGrid />
        </ToolbarButton>
        <div className="toolbar-navigation" role="group" aria-label="Page navigation">
          <PageNumberInput
            key={activeTab.id}
            page={activeTab.view.page}
            pages={activeTab.view.pages}
            onPageChange={onPageChange}
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
            <Popover open={zoomOpen} onOpenChange={setZoomOpen}>
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
