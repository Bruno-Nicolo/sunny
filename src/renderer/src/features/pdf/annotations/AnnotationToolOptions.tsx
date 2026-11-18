import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ColorOptions } from './ColorOptions'
import { highlightColors } from './highlight/colors'
import { textColors, textSizes } from './text/options'
import type { TextEditorSettings } from './text/types'
import type { AnnotationTool } from './types'

type Props = {
  annotationTool: AnnotationTool
  highlightColor: string
  textSettings: TextEditorSettings | null
  onHighlightColorChange(color: string): void
}

export function AnnotationToolOptions({
  annotationTool,
  highlightColor,
  textSettings,
  onHighlightColorChange
}: Props): React.JSX.Element | null {
  const text = annotationTool === 'text' ? textSettings : null
  if (annotationTool !== 'highlight' && !text) return null

  const colors = text ? textColors : highlightColors
  const color = text ? text.color : highlightColor
  const label = text ? 'Text color' : 'Highlight color'

  return (
    <div
      className="tool-options"
      data-text-settings={text ? '' : undefined}
      role="group"
      aria-label={text ? 'Text options' : 'Highlight options'}
      onPointerDown={(event) => {
        event.stopPropagation()
        if ((event.target as HTMLElement).closest('button')) event.preventDefault()
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {text && (
        <Select value={String(text.size)} onValueChange={(value) => text.setSize(Number(value))}>
          <SelectTrigger aria-label="Text size" size="sm" className="w-20 px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            position="popper"
            align="start"
            data-text-settings
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const editor = text.element?.querySelector<HTMLElement>('.internal')
              if (editor?.isContentEditable && editor.closest('.visible')) editor.focus()
            }}
          >
            {[...new Set([...textSizes, text.size])]
              .sort((a, b) => a - b)
              .map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} pt
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      )}
      <ColorOptions
        label={label}
        colors={colors}
        value={color}
        onChange={text ? text.setColor : onHighlightColorChange}
      />
    </div>
  )
}
