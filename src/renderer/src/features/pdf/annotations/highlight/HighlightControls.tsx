import { useState } from 'react'
import { ChevronDown, Highlighter } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { ToolbarButton } from '@/components/ToolbarButton'
import { ButtonGroup } from '@/components/ui/button-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ColorOptions } from '../ColorOptions'
import type { AnnotationTool } from '../types'
import { highlightColors } from './colors'

type Props = {
  annotationTool: AnnotationTool
  color: string
  disabled: boolean
  signed: boolean
  onToolChange(tool: AnnotationTool): void
  onColorChange(color: string): void
}
export function HighlightControls({
  annotationTool,
  color: highlightColor,
  disabled,
  signed,
  onToolChange,
  onColorChange
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const selected = annotationTool === 'highlight'
  const colorName = highlightColors.find((color) => color.value === highlightColor)?.name

  return (
    <ButtonGroup
      aria-label="Highlight controls"
      className={cn(
        'rounded-md transition-colors [&>button:hover]:bg-transparent [&>button:hover]:text-inherit dark:[&>button:hover]:bg-transparent',
        selected
          ? 'bg-secondary text-secondary-foreground'
          : !disabled && 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        open && !disabled && !selected && 'bg-accent text-accent-foreground dark:bg-accent/50'
      )}
    >
      <ToolbarButton
        label="Highlight text"
        tooltip={signed ? 'Signed PDFs are read-only' : 'Highlight text or draw on blank areas (H)'}
        aria-keyshortcuts="h"
        variant="ghost"
        pressed={selected}
        disabled={disabled}
        onClick={() => onToolChange(selected ? 'none' : 'highlight')}
      >
        <Highlighter />
      </ToolbarButton>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`Highlight color: ${colorName ?? highlightColor}`}
            className="w-5 px-0 has-[>svg]:px-0"
          >
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto space-y-1 p-2"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="text-sm">Colors</div>
          <ColorOptions
            label="Highlight color"
            colors={highlightColors}
            value={highlightColor}
            onChange={(color) => {
              onColorChange(color)
              onToolChange('highlight')
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </ButtonGroup>
  )
}
