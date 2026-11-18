import { ToolOptionHeading } from '@/components/ToolOptionHeading'
import { Field, FieldGroup } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToolOptionSlider } from '@/components/ToolOptionSlider'
import { ColorOptions } from './ColorOptions'
import { highlightColors } from './highlight/colors'
import { textColors, textSizes } from './text/options'
import type { TextEditorSettings } from './text/types'
import type { AnnotationTool, HighlightStyle } from './types'

type Props = {
  annotationTool: AnnotationTool
  highlightStyle: HighlightStyle
  textSettings: TextEditorSettings | null
  onHighlightStyleChange(style: Partial<HighlightStyle>, live?: boolean): void
}

export function AnnotationToolOptions({
  annotationTool,
  highlightStyle,
  textSettings,
  onHighlightStyleChange
}: Props): React.JSX.Element | null {
  const text = annotationTool === 'text' ? textSettings : null
  if (annotationTool !== 'highlight' && !text) return null

  const colors = text ? textColors : highlightColors
  const color = text ? text.color : highlightStyle.color
  const label = text ? 'Text color' : 'Highlight color'

  return (
    <FieldGroup
      className="gap-8"
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
        <Field>
          <ToolOptionHeading id="text-size" title="Text size" htmlFor="tool-text-size" />
          <Select value={String(text.size)} onValueChange={(value) => text.setSize(Number(value))}>
            <SelectTrigger
              id="tool-text-size"
              aria-label="Text size"
              size="sm"
              className="w-20 px-2"
            >
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
        </Field>
      )}
      <Field>
        <ToolOptionHeading id="tool-color" title="Color" />
        <ColorOptions
          label={label}
          colors={colors}
          value={color}
          onChange={text ? text.setColor : (color) => onHighlightStyleChange({ color })}
        />
      </Field>
      {!text && (
        <>
          <ToolOptionSlider
            title="Opacity"
            unit="%"
            min={10}
            max={100}
            step={5}
            value={Math.round(highlightStyle.opacity * 100)}
            onValueChange={(value, live) => onHighlightStyleChange({ opacity: value / 100 }, live)}
          />
          <ToolOptionSlider
            title="Stroke size"
            description="Applies to freehand strokes."
            unit=" pt"
            min={2}
            max={40}
            value={highlightStyle.thickness}
            onValueChange={(thickness, live) => onHighlightStyleChange({ thickness }, live)}
          />
          <div
            className="flex h-16 items-center overflow-hidden rounded-md border bg-background px-6 py-2"
            aria-hidden="true"
          >
            <svg viewBox="0 0 180 48" className="h-12 w-full overflow-visible">
              <path
                d="M 20 29 Q 55 10 90 24 T 160 22"
                fill="none"
                stroke={highlightStyle.color}
                strokeWidth={highlightStyle.thickness}
                strokeLinecap="round"
                opacity={highlightStyle.opacity}
              />
            </svg>
          </div>
        </>
      )}
    </FieldGroup>
  )
}
