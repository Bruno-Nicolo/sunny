import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AnnotationTool } from './types'

type Props = {
  tool: Exclude<AnnotationTool, 'none'>
  activeTool: AnnotationTool
  label: string
  tooltip?: string
  icon: IconSvgElement
  disabled: boolean
  onChange(tool: AnnotationTool): void
}

export function AnnotationToolButton({
  tool,
  activeTool,
  label,
  tooltip = label,
  icon,
  disabled,
  onChange
}: Props): React.JSX.Element {
  const selected = activeTool === tool
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={selected ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label={label}
          aria-pressed={selected}
          disabled={disabled}
          onClick={() => onChange(selected ? 'none' : tool)}
        >
          <HugeiconsIcon icon={icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
