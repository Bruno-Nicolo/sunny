import { AnnotationEditorParamsType } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { AnnotationEditor } from 'pdfjs-dist/types/src/display/editor/editor'
import type { EditorEvents } from '../editorEvents'
import { highlightColors } from './colors'

export const pdfHighlightColors = highlightColors
  .map(({ name, value }) => `${name.toLowerCase()}=${value}`)
  .join(',')

export function createHighlightEditor(events: EditorEvents): { setColor(color: string): void } {
  return {
    setColor(color: string): void {
      const selected = events.getSelectedEditor()
      // PDF.js updates only selected annotations; the toolbar also sets the next highlight's color.
      if (!events.signal.aborted && selected?.editorType === 'highlight') {
        const editorType = selected.constructor as typeof AnnotationEditor
        editorType.updateDefaultParams(AnnotationEditorParamsType.HIGHLIGHT_COLOR, color)
      }
      events.setParam(AnnotationEditorParamsType.HIGHLIGHT_COLOR, color)
    }
  }
}
