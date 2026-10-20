import { BookOpen, LayoutTemplate, Presentation, RotateCw } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

type Props = {
  disabled: boolean
  twoPageView: boolean
  onRotateClockwise(): void
  onToggleTwoPageView(): void
  onStartPresentation(): void
}

export function PdfViewDropdown({
  disabled,
  twoPageView,
  onRotateClockwise,
  onToggleTwoPageView,
  onStartPresentation
}: Props): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton label="PDF view" disabled={disabled}>
          <LayoutTemplate />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuItem onSelect={onRotateClockwise}>
          <RotateCw />
          Rotate clockwise
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={twoPageView} onCheckedChange={onToggleTwoPageView}>
          <BookOpen />
          Two-page view
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem onSelect={onStartPresentation}>
          <Presentation />
          Presentation mode
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
