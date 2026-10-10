import { AnnotationEditorParamsType } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { EditorEvents } from '../editorEvents'
import { highlightColors } from './colors'

export const pdfHighlightColors = highlightColors
  .map(({ name, value }) => `${name.toLowerCase()}=${value}`)
  .join(',')

export function createHighlightEditor(events: EditorEvents): { setColor(color: string): void } {
  return {
    setColor(color: string): void {
      events.setParam(AnnotationEditorParamsType.HIGHLIGHT_COLOR, color)
    }
  }
}
