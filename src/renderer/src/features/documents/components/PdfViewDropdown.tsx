import { BookOpen, Contrast, Presentation, RotateCw, Settings2 } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

type Props = {
  align?: 'start' | 'center' | 'end'
  disabled: boolean
  twoPageView: boolean
  invertColors: boolean
  onRotateClockwise(): void
  onToggleTwoPageView(): void
  onToggleInvertColors(): void
  onStartPresentation(): void
}

export function PdfViewDropdown({
  align = 'center',
  disabled,
  twoPageView,
  invertColors,
  onRotateClockwise,
  onToggleTwoPageView,
  onToggleInvertColors,
  onStartPresentation
}: Props): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton label="PDF view" disabled={disabled}>
          <Settings2 />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuItem onSelect={onRotateClockwise}>
          <RotateCw />
          Rotate clockwise
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={twoPageView} onCheckedChange={onToggleTwoPageView}>
          <BookOpen />
          Two-page view
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={invertColors} onCheckedChange={onToggleInvertColors}>
          <Contrast />
          Invert colors
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem onSelect={onStartPresentation}>
          <Presentation />
          Presentation mode
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
