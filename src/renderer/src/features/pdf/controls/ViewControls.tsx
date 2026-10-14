import { Columns2, RotateCw } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'

type Props = {
  disabled: boolean
  twoPageView: boolean
  onRotateClockwise(): void
  onToggleTwoPageView(): void
}

export function ViewControls({
  disabled,
  twoPageView,
  onRotateClockwise,
  onToggleTwoPageView
}: Props): React.JSX.Element {
  return (
    <>
      <ToolbarButton label="Rotate clockwise" disabled={disabled} onClick={onRotateClockwise}>
        <RotateCw />
      </ToolbarButton>
      <ToolbarButton
        label="Two-page view"
        tooltip={twoPageView ? 'Show one page' : 'Show two pages side by side'}
        pressed={twoPageView}
        disabled={disabled}
        onClick={onToggleTwoPageView}
      >
        <Columns2 />
      </ToolbarButton>
    </>
  )
}
