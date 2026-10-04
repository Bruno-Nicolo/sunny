import { useRef } from 'react'
import {
  Check,
  ChevronDown,
  Highlighter,
  ImagePlus,
  Minus,
  Monitor,
  Moon,
  Plus,
  Sun
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SessionState } from '../../../../../shared/contracts'
import type { Tab } from '../types'
import { highlightColors } from '@/features/pdf/highlightColors'

type Props = {
  activeTab: Pick<Tab, 'view'> | null
  highlightEnabled: boolean
  highlightColor: string
  theme: SessionState['theme']
  imageAccept: string
  onToggleHighlight(): void
  onHighlightColorChange(color: string): void
  onAddImages(files: File[]): void
  onPageChange(page: number): void
  onScaleChange(scale: string): void
  onZoomIn(): void
  onZoomOut(): void
  onCycleTheme(): void
}

export function DocumentToolbar({
  activeTab,
  highlightEnabled,
  highlightColor,
  theme,
  imageAccept,
  onToggleHighlight,
  onHighlightColorChange,
  onAddImages,
  onPageChange,
  onScaleChange,
  onZoomIn,
  onZoomOut,
  onCycleTheme
}: Props): React.JSX.Element {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  return (
    <div className="titlebar-no-drag flex h-11 items-center gap-1 border-t px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={highlightEnabled ? 'secondary' : 'ghost'}
            size="icon-sm"
            disabled={!activeTab?.view.canAnnotate}
            onClick={onToggleHighlight}
          >
            <Highlighter />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {activeTab?.view.signed ? 'Signed PDFs are read-only' : 'Highlight text'}
        </TooltipContent>
      </Tooltip>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={!activeTab?.view.canAnnotate}
            className="gap-1.5 px-2"
          >
            <span
              className="size-4 rounded-full border border-black/10"
              style={{ backgroundColor: highlightColor }}
            />
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <div className="flex gap-1">
            {highlightColors.map((color) => (
              <button
                key={color.value}
                type="button"
                aria-label={color.name}
                onClick={() => onHighlightColorChange(color.value)}
                className="relative grid size-8 place-items-center rounded-md hover:bg-muted"
              >
                <span
                  className="size-5 rounded-full border border-black/10"
                  style={{ backgroundColor: color.value }}
                />
                {highlightColor === color.value && (
                  <Check className="absolute size-3 text-black/70" />
                )}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <input
        ref={imageInputRef}
        type="file"
        accept={imageAccept}
        multiple
        hidden
        aria-label="Choose images"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          onAddImages(files)
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Add image"
            disabled={!activeTab?.view.canAnnotate}
            onClick={() => imageInputRef.current?.click()}
          >
            <ImagePlus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add image (or paste with ⌘V)</TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      {activeTab && (
        <>
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
          <Separator orientation="vertical" className="mx-1 h-5" />
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
        </>
      )}
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onCycleTheme}>
            <ThemeIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Theme: {theme}</TooltipContent>
      </Tooltip>
    </div>
  )
}
