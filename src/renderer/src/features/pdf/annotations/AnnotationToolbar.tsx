import { TextControls } from './text/TextControls'
import type { TextEditorSettings } from './text/types'
import { HighlightControls } from './highlight/HighlightControls'
import { ImageInputButton } from './images/ImageInputButton'
import type { AnnotationOptions, AnnotationTool } from './types'

type Props = Pick<AnnotationOptions, 'annotationTool' | 'highlightColor'> & {
  canAnnotate: boolean
  signed: boolean
  textSettings: TextEditorSettings | null
  onAnnotationToolChange(tool: AnnotationTool): void
  onHighlightColorChange(color: string): void
  onAddImages(files: File[]): void
}

export function AnnotationToolbar({
  annotationTool,
  highlightColor,
  canAnnotate,
  signed,
  textSettings,
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
      <TextControls
        annotationTool={annotationTool}
        settings={textSettings}
        disabled={!canAnnotate}
        onToolChange={onAnnotationToolChange}
      />
      <ImageInputButton disabled={!canAnnotate} onAddImages={onAddImages} />
    </>
  )
}
