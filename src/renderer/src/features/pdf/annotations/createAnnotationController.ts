import { AnnotationEditorType } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { EventBus, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import { commitDraft } from './commitDraft'
import { createEditorEvents } from './editorEvents'
import { createHighlightEditor } from './highlight/highlightEditor'
import { createImageEditor } from './images/imageEditor'
import { createTextEditor } from './text/textEditor'
import type { TextEditorSettings } from './text/types'
import type { AnnotationOptions } from './types'
import type { PdfDocumentHandle } from '../types'

type Options = {
  eventBus: EventBus
  viewer: PDFViewer
  container: HTMLDivElement
  signal: AbortSignal
  initialOptions: AnnotationOptions
  onDirtyChange(dirty: boolean): void
  onTextEditorChange(settings: TextEditorSettings | null): void
}

type AnnotationController = Pick<PdfDocumentHandle, 'addImage' | 'undo' | 'redo'> & {
  initialize(canAnnotate: boolean): void
  setOptions(options: AnnotationOptions): void
  commitDraft(): void
  commit(): void
}

const modes = {
  none: AnnotationEditorType.NONE,
  highlight: AnnotationEditorType.HIGHLIGHT,
  text: AnnotationEditorType.FREETEXT
}

// Compose the annotation tools for one viewer; loading and permissions stay with the document.
export function createAnnotationController({
  eventBus,
  viewer,
  container,
  signal,
  initialOptions,
  onDirtyChange,
  onTextEditorChange
}: Options): AnnotationController {
  let options = initialOptions
  let ready = false
  let permitted = false
  const canEdit = (): boolean => ready && permitted && !signal.aborted
  const isActive = (): boolean => options.active
  const events = createEditorEvents({ eventBus, viewer, signal })
  const highlight = createHighlightEditor(events)
  const images = createImageEditor({ events, container, canEdit, isActive })
  const text = createTextEditor({ events, container, isActive, onDirtyChange, onTextEditorChange })
  const applyMode = (): void => {
    if (canEdit()) events.setMode({ mode: modes[isActive() ? options.annotationTool : 'none'] })
  }
  events.on('switchannotationeditormode', (modeOptions) => {
    if (canEdit() && isActive()) events.setMode(modeOptions)
  })

  return {
    initialize(canAnnotate: boolean): void {
      ready = true
      permitted = canAnnotate
      applyMode()
      highlight.setColor(options.highlightColor)
      text.refresh()
    },
    setOptions(next: AnnotationOptions): void {
      const modeChanged =
        options.active !== next.active || options.annotationTool !== next.annotationTool
      const colorChanged = options.highlightColor !== next.highlightColor
      options = next
      if (modeChanged) applyMode()
      if (colorChanged && ready) highlight.setColor(options.highlightColor)
    },
    addImage: images.add,
    commit: events.commit,
    commitDraft: () => commitDraft(events),
    undo(): void {
      events.runHistoryAction('undo')
      text.refresh()
    },
    redo(): void {
      events.runHistoryAction('redo')
      text.refresh()
    }
  }
}
