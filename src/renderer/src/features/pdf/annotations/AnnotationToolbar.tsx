import { Type } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import { HighlightControls } from './highlight/HighlightControls'
import { ImageInputButton } from './images/ImageInputButton'
import type { AnnotationOptions, AnnotationTool } from './types'

type Props = Pick<AnnotationOptions, 'annotationTool' | 'highlightColor'> & {
  canAnnotate: boolean
  signed: boolean
  onAnnotationToolChange(tool: AnnotationTool): void
  onHighlightColorChange(color: string): void
  onAddImages(files: File[]): void
}

export function AnnotationToolbar({
  annotationTool,
  highlightColor,
  canAnnotate,
  signed,
  onAnnotationToolChange,
  onHighlightColorChange,
  onAddImages
}: Props): React.JSX.Element {
  return (
    <>
      <HighlightControls
        annotationTool={annotationTool}
        color={highlightColor}
        disabled={!canAnnotate}
        signed={signed}
        onToolChange={onAnnotationToolChange}
        onColorChange={onHighlightColorChange}
      />
      <ToolbarButton
        label="Add text"
        pressed={annotationTool === 'text'}
        disabled={!canAnnotate}
        onClick={() => onAnnotationToolChange(annotationTool === 'text' ? 'none' : 'text')}
      >
        <Type />
      </ToolbarButton>
      <ImageInputButton disabled={!canAnnotate} onAddImages={onAddImages} />
    </>
  )
}
