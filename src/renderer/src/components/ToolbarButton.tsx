import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Props = ComponentProps<typeof Button> & {
  label: string
  tooltip?: string
  pressed?: boolean
}

export function ToolbarButton({
  label,
  tooltip = label,
  pressed,
  variant = pressed ? 'secondary' : 'ghost',
  size = 'icon-sm',
  ...props
}: Props): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          aria-label={label}
          aria-pressed={pressed}
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
