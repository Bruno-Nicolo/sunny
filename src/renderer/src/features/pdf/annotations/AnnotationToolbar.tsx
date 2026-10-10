import { Type } from 'lucide-react'
import { AnnotationToolButton } from './AnnotationToolButton'
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
      <AnnotationToolButton
        tool="text"
        activeTool={annotationTool}
        label="Add text"
        icon={Type}
        disabled={!canAnnotate}
        onChange={onAnnotationToolChange}
      />
      <ImageInputButton disabled={!canAnnotate} onAddImages={onAddImages} />
    </>
  )
}
