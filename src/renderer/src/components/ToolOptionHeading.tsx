import type { ReactNode } from 'react'
import { FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field'

type Props = {
  id: string
  title: string
  description?: string
  value?: ReactNode
  htmlFor?: string
}

export function ToolOptionHeading({
  id,
  title,
  description,
  value,
  htmlFor
}: Props): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <FieldContent className="gap-0.5">
        {htmlFor ? (
          <FieldLabel id={`${id}-label`} htmlFor={htmlFor} className="font-normal">
            {title}
          </FieldLabel>
        ) : (
          <FieldTitle id={`${id}-label`} className="font-normal">
            {title}
          </FieldTitle>
        )}
        {description && <FieldDescription id={`${id}-description`}>{description}</FieldDescription>}
      </FieldContent>
      {value !== undefined && (
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{value}</span>
      )}
    </div>
  )
}
