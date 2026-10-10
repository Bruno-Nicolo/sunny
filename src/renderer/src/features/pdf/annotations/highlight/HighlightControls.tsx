import { Check, ChevronDown, Highlighter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AnnotationToolButton } from '../AnnotationToolButton'
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
  return (
    <>
      <AnnotationToolButton
        tool="highlight"
        activeTool={annotationTool}
        label="Highlight text"
        tooltip={signed ? 'Signed PDFs are read-only' : 'Highlight text'}
        icon={Highlighter}
        disabled={disabled}
        onChange={onToolChange}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" disabled={disabled} className="gap-1.5 px-2">
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
                onClick={() => onColorChange(color.value)}
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
    </>
  )
}
