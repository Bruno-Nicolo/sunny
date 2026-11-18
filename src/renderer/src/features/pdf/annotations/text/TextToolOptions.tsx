import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Field } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToolOptionNumberInput } from '@/components/ToolOptionNumberInput'
import { ToolOptionHeading } from '@/components/ToolOptionHeading'
import { ColorOptions } from '../ColorOptions'
import { textColors, textFonts } from './options'
import type { TextEditorSettings, TextFontFamily } from './types'

const alignments = [
  { value: 'left', label: 'Align left', icon: AlignLeft },
  { value: 'center', label: 'Align center', icon: AlignCenter },
  { value: 'right', label: 'Align right', icon: AlignRight }
] as const

export function TextToolOptions({ settings }: { settings: TextEditorSettings }): React.JSX.Element {
  return (
    <>
      <ToolOptionNumberInput
        title="Text size"
        value={settings.fontSize}
        min={6}
        max={144}
        onValueChange={(fontSize) => settings.setStyle({ fontSize })}
      />
      <Field>
        <ToolOptionHeading id="text-color" title="Color" />
        <ColorOptions
          label="Text color"
          colors={textColors}
          value={settings.color}
          onChange={(color) => settings.setStyle({ color })}
        />
      </Field>
      <Field>
        <ToolOptionHeading id="text-font" title="Font" htmlFor="tool-text-font" />
        <Select
          value={settings.fontFamily}
          onValueChange={(fontFamily) =>
            settings.setStyle({ fontFamily: fontFamily as TextFontFamily })
          }
        >
          <SelectTrigger
            id="tool-text-font"
            aria-label="Text font"
            className="w-40"
            style={{ fontFamily: textFonts[settings.fontFamily].css }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            position="popper"
            align="start"
            data-text-settings
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const editor = settings.element?.querySelector<HTMLElement>('.internal')
              if (editor?.isContentEditable && editor.closest('.visible')) editor.focus()
            }}
          >
            {Object.entries(textFonts).map(([value, font]) => (
              <SelectItem key={value} value={value} style={{ fontFamily: font.css }}>
                {font.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <ToolOptionHeading id="text-alignment" title="Alignment" />
        <ButtonGroup aria-labelledby="text-alignment-label" className="w-full">
          {alignments.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant="outline"
              size="sm"
              className="flex-1 aria-pressed:bg-accent"
              aria-label={label}
              title={label}
              aria-pressed={settings.textAlign === value}
              onClick={() => settings.setStyle({ textAlign: value })}
            >
              <Icon />
            </Button>
          ))}
        </ButtonGroup>
      </Field>
    </>
  )
}
