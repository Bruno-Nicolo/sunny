import { AnnotationEditorParamsType, AnnotationEditorType } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { EditorEvents } from '../editorEvents'
import { validateImage } from './imageFiles'

type Options = {
  events: EditorEvents
  container: HTMLDivElement
  canEdit(): boolean
  isActive(): boolean
}

export function createImageEditor({ events, container, canEdit, isActive }: Options): {
  add(file: File): Promise<void>
} {
  return {
    async add(file: File): Promise<void> {
      if (!canEdit()) throw new Error('This PDF is not ready for editing.')
      await validateImage(file)
      if (!canEdit() || !isActive()) return
      await events.enterMode(AnnotationEditorType.STAMP)
      if (!canEdit() || !isActive()) return
      container.focus()
      events.setParam(AnnotationEditorParamsType.CREATE, { bitmapFile: file })
    }
  }
}
