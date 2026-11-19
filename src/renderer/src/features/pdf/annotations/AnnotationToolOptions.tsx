import { ToolOptionHeading } from '@/components/ToolOptionHeading'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ToolOptionSlider } from '@/components/ToolOptionSlider'
import { ColorOptions } from './ColorOptions'
import { highlightColors } from './highlight/colors'
import { TextToolOptions } from './text/TextToolOptions'
import type { TextEditorSettings } from './text/types'
import type { AnnotationTool, HighlightStyle } from './types'

type Props = {
  annotationTool: AnnotationTool
  highlightStyle: HighlightStyle
  highlightFreehandOnly: boolean
  onHighlightFreehandOnlyChange(checked: boolean): void
  textSettings: TextEditorSettings | null
  onHighlightStyleChange(style: Partial<HighlightStyle>, live?: boolean): void
}

export function AnnotationToolOptions({
  annotationTool,
  highlightStyle,
  highlightFreehandOnly,
  onHighlightFreehandOnlyChange,
  textSettings,
  onHighlightStyleChange
}: Props): React.JSX.Element | null {
  const text = annotationTool === 'text' ? textSettings : null
  if (annotationTool !== 'highlight' && !text) return null

  return (
    <FieldGroup
      className="gap-8"
      data-text-settings={text ? '' : undefined}
      role="group"
      aria-label={text ? 'Text options' : 'Highlight options'}
      onPointerDown={(event) => {
        event.stopPropagation()
        if ((event.target as Element).closest('button:not([role="checkbox"])'))
          event.preventDefault()
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {text ? (
        <TextToolOptions settings={text} />
      ) : (
        <>
          <Field>
            <ToolOptionHeading id="highlight-color" title="Color" />
            <ColorOptions
              label="Highlight color"
              colors={highlightColors}
              value={highlightStyle.color}
              onChange={(color) => onHighlightStyleChange({ color })}
            />
          </Field>
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
          <Field className="flex-row items-center gap-2">
            <Checkbox
              id="highlight-freehand-only"
              checked={highlightFreehandOnly}
              onCheckedChange={(checked) => onHighlightFreehandOnlyChange(checked === true)}
            />
            <FieldLabel htmlFor="highlight-freehand-only">Freehand only</FieldLabel>
          </Field>
        </>
      )}
    </FieldGroup>
  )
}
