import { createPortal } from 'react-dom'
import './text.css'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tick02Icon, SlidersHorizontalIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover'
import type { TextEditorSettings } from './types'

const textColors = [
  { name: 'Black', value: '#000000' },
  { name: 'Gray', value: '#6B7280' },
  { name: 'Red', value: '#FF0000' },
  { name: 'Green', value: '#16A34A' },
  { name: 'Blue', value: '#2563EB' },
  { name: 'Purple', value: '#9333EA' }
] as const

export function TextSettingsMenu({
  settings
}: {
  settings: TextEditorSettings
}): React.JSX.Element {
  const sizes = [...new Set([8, 10, 12, 16, 20, 24, 32, 48, 72, settings.size])].sort(
    (a, b) => a - b
  )

  return createPortal(
    <div
      data-text-settings
      className="text-settings-anchor"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Text settings"
            title="Text settings"
            className="shadow-sm"
            onPointerDown={(event) => event.preventDefault()}
          >
            <HugeiconsIcon icon={SlidersHorizontalIcon} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          data-text-settings
          side="bottom"
          align="start"
          sideOffset={8}
          className="w-64 space-y-3 p-3"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const text = settings.element.querySelector<HTMLElement>('.internal')
            if (text?.isContentEditable) text.focus()
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <PopoverHeader>
            <PopoverTitle>Text settings</PopoverTitle>
          </PopoverHeader>
          <div role="group" aria-label="Text color" className="space-y-1">
            <div className="text-sm">Color</div>
            <div className="flex justify-center gap-1">
              {textColors.map((color) => {
                const selected = settings.color.toLowerCase() === color.value.toLowerCase()
                return (
                  <Button
                    key={color.value}
                    variant="ghost"
                    size="icon-sm"
                    aria-label={color.name}
                    aria-pressed={selected}
                    title={color.name}
                    className="relative"
                    onClick={() => settings.setColor(color.value)}
                  >
                    <span
                      className="size-5 rounded-full border border-black/10"
                      style={{ backgroundColor: color.value }}
                    />
                    {selected && (
                      <HugeiconsIcon icon={Tick02Icon} className="absolute size-3 text-white" />
                    )}
                  </Button>
                )
              })}
            </div>
          </div>
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
        </PopoverContent>
      </Popover>
    </div>,
    settings.element
  )
}
