import { useState } from 'react'
import { ChevronDown, Type } from 'lucide-react'
import { cn } from 'cn'
import { ToolbarButton } from '@/components/ToolbarButton'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ColorOptions } from '../ColorOptions'
import type { AnnotationTool } from '../types'
import type { TextEditorSettings } from './types'

const textColors = [
  { name: 'Black', value: '#000000' },
  { name: 'Gray', value: '#6B7280' },
  { name: 'Red', value: '#FF0000' },
  { name: 'Green', value: '#16A34A' },
  { name: 'Blue', value: '#2563EB' },
  { name: 'Purple', value: '#9333EA' }
] as const

type Props = {
  annotationTool: AnnotationTool
  settings: TextEditorSettings | null
  disabled: boolean
  onToolChange(tool: AnnotationTool): void
}

export function TextControls({
  annotationTool,
  settings,
  disabled,
  onToolChange
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const selected = annotationTool === 'text'
  const sizes = settings
    ? [...new Set([8, 10, 12, 16, 20, 24, 32, 48, 72, settings.size])].sort((a, b) => a - b)
    : []

  return (
    <ButtonGroup
      data-text-settings
      aria-label="Text controls"
      className={cn(
        'rounded-md transition-colors [&>button:hover]:bg-transparent [&>button:hover]:text-inherit dark:[&>button:hover]:bg-transparent',
        selected
          ? 'bg-secondary text-secondary-foreground'
          : !disabled && 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        open && !disabled && !selected && 'bg-accent text-accent-foreground dark:bg-accent/50'
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <ToolbarButton
        label="Add text"
        tooltip="Add text (T)"
        aria-keyshortcuts="t"
        pressed={selected}
        variant="ghost"
        disabled={disabled}
        onClick={() => onToolChange(selected ? 'none' : 'text')}
      >
        <Type />
      </ToolbarButton>
      <Popover
        open={open && !disabled && settings !== null}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (nextOpen && !selected) onToolChange('text')
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Text settings"
            disabled={disabled || !settings}
            className="w-5 px-0 has-[>svg]:px-0"
            onPointerDown={(event) => event.preventDefault()}
          >
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
        {settings && (
          <PopoverContent
            data-text-settings
            align="start"
            className="w-64 space-y-3 p-3"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onFocusOutside={(event) => {
              const target = event.detail.originalEvent.target
              if (target instanceof Node && settings.element?.contains(target))
                event.preventDefault()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const text = settings.element?.querySelector<HTMLElement>('.internal')
              if (text?.isContentEditable && text.closest('.visible')) {
                text.focus()
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div role="group" aria-label="Text size" className="space-y-1">
              <div className="text-sm">Size</div>
              <div className="grid grid-cols-3 gap-1">
                {sizes.map((size) => (
                  <Button
                    key={size}
                    variant={settings.size === size ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-pressed={settings.size === size}
                    onClick={() => settings.setSize(size)}
                  >
                    {size} pt
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm">Colors</div>
              <ColorOptions
                label="Text color"
                colors={textColors}
                value={settings.color}
                onChange={settings.setColor}
              />
            </div>
          </PopoverContent>
        )}
      </Popover>
    </ButtonGroup>
  )
}
