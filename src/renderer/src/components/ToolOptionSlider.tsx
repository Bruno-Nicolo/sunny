import { useId } from 'react'
import { ToolOptionHeading } from './ToolOptionHeading'
import { Field } from './ui/field'
import { Slider } from './ui/slider'

type Props = {
  title: string
  description?: string
  value: number
  unit: string
  min: number
  max: number
  step?: number
  onDragStart?(): void
  onDragEnd?(): void
  onValueChange(value: number, live: boolean): void
}

export function ToolOptionSlider({
  title,
  description,
  value,
  unit,
  min,
  max,
  step = 1,
  onDragStart,
  onDragEnd,
  onValueChange
}: Props): React.JSX.Element {
  const id = useId()
  const formattedValue = `${value}${unit}`

  return (
    <Field>
      <ToolOptionHeading id={id} title={title} description={description} value={formattedValue} />
      <Slider
        aria-label={title}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        aria-valuetext={formattedValue}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onPointerDownCapture={onDragStart}
        onLostPointerCapture={onDragEnd}
        onValueChange={([next]) => onValueChange(next, true)}
        onValueCommit={([next]) => onValueChange(next, false)}
      />
    </Field>
  )
}
