import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Props = {
  label: string
  colors: readonly { name: string; value: string }[]
  value: string
  onChange(value: string): void
}

export function ColorOptions({ label, colors, value, onChange }: Props): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className="flex justify-center gap-1">
      {colors.map((color) => {
        const selected = value.toLowerCase() === color.value.toLowerCase()
        return (
          <Tooltip key={color.value}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={color.name}
                aria-pressed={selected}
                onClick={() => onChange(color.value)}
              >
                <span
                  className={cn(
                    'size-5 rounded-full border border-black/10',
                    selected && 'ring-2 ring-foreground/60 ring-offset-2 ring-offset-popover'
                  )}
                  style={{ backgroundColor: color.value }}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {color.name}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
