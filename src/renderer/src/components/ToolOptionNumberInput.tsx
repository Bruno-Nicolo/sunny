import { useId, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { ToolOptionHeading } from './ToolOptionHeading'
import { Field } from './ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group'

const adjustments = [
  { amount: -1, align: 'inline-start', label: 'Decrease', icon: Minus },
  { amount: 1, align: 'inline-end', label: 'Increase', icon: Plus }
] as const

type Props = {
  title: string
  value: number
  min: number
  max: number
  onValueChange(value: number): void
}

export function ToolOptionNumberInput({
  title,
  value,
  min,
  max,
  onValueChange
}: Props): React.JSX.Element {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const parse = (text: string): number =>
    text.trim() && Number.isFinite(Number(text)) ? Number(text) : value
  const current = parse(draft ?? String(value))
  const update = (next: number): void => {
    setDraft(null)
    onValueChange(Math.min(max, Math.max(min, next)))
  }

  return (
    <Field>
      <ToolOptionHeading id={id} title={title} htmlFor={id} />
      <InputGroup className="w-32">
        <InputGroupInput
          id={id}
          type="number"
          inputMode="decimal"
          aria-label={title}
          min={min}
          max={max}
          step="any"
          value={draft ?? String(value)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => update(parse(event.currentTarget.value))}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(null)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              update(current + (event.key === 'ArrowUp' ? 1 : -1))
            }
          }}
          className="text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {adjustments.map(({ amount, align, label, icon: Icon }) => (
          <InputGroupAddon key={align} align={align}>
            <InputGroupButton
              size="icon-xs"
              aria-label={`${label} ${title.toLowerCase()}`}
              disabled={amount < 0 ? current <= min : current >= max}
              onClick={() => update(current + amount)}
            >
              <Icon />
            </InputGroupButton>
          </InputGroupAddon>
        ))}
      </InputGroup>
    </Field>
  )
}
