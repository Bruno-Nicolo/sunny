import { Highlighter, Type } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import type { AnnotationTool } from './types'

type Props = {
  annotationTool: AnnotationTool
  canAnnotate: boolean
  signed: boolean
  onAnnotationToolChange(tool: AnnotationTool): void
}

export function AnnotationToolbar({
  annotationTool,
  canAnnotate,
  signed,
  onAnnotationToolChange
}: Props): React.JSX.Element {
  return (
    <>
      <ToolbarButton
        label="Highlight text"
        tooltip={signed ? 'Signed PDFs are read-only' : 'Highlight (H)'}
        aria-keyshortcuts="h"
        pressed={annotationTool === 'highlight'}
        disabled={!canAnnotate}
        onClick={() =>
          onAnnotationToolChange(annotationTool === 'highlight' ? 'none' : 'highlight')
        }
      >
        <Highlighter />
      </ToolbarButton>
      <ToolbarButton
        label="Add text"
        tooltip="Add text (T)"
        aria-keyshortcuts="t"
        data-text-settings
        pressed={annotationTool === 'text'}
        disabled={!canAnnotate}
        onClick={() => onAnnotationToolChange(annotationTool === 'text' ? 'none' : 'text')}
      >
        <Type />
      </ToolbarButton>
    </>
  )
}
