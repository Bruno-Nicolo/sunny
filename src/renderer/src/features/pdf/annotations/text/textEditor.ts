import { AnnotationEditorParamsType, AnnotationEditorType } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { EditorEvents } from '../editorEvents'
import type { TextEditorSettings } from './types'

type Options = {
  events: EditorEvents
  container: HTMLDivElement
  isActive(): boolean
  onDirtyChange(dirty: boolean): void
  onTextEditorChange(settings: TextEditorSettings | null): void
}

export function createTextEditor({
  events,
  container,
  isActive,
  onDirtyChange,
  onTextEditorChange
}: Options): { refresh(): void } {
  let textSettings: TextEditorSettings | null = null
  const defaults = { color: '#000000', size: 16 }
  let textPosition = ''
  let textUpdateQueued = false
  const updateTextEditor = (): void => {
    if (textUpdateQueued) return
    textUpdateQueued = true
    // PDF.js emits selection updates before it finishes changing the editor DOM.
    queueMicrotask(() => {
      textUpdateQueued = false
      if (events.signal.aborted) return
      const editor = events.getSelectedEditor() ?? events.getActiveEditor()
      const element = editor?.div
      if (!editor || !element?.isConnected || editor.editorType !== 'freetext') {
        if (
          textSettings?.element === null &&
          textSettings.color === defaults.color &&
          textSettings.size === defaults.size
        )
          return
        const setDefault = (type: number, value: string | number): void => {
          if (events.signal.aborted || !isActive()) return
          if (type === AnnotationEditorParamsType.FREETEXT_COLOR) defaults.color = value as string
          else defaults.size = value as number
          if (!events.hasSelection()) events.setParam(type, value)
          updateTextEditor()
        }
        textSettings = {
          element: null,
          ...defaults,
          setColor: (color) => setDefault(AnnotationEditorParamsType.FREETEXT_COLOR, color),
          setSize: (size) => setDefault(AnnotationEditorParamsType.FREETEXT_SIZE, size)
        }
        onTextEditorChange(textSettings)
        return
      }
      const params = new Map<number, string | number>(editor.propertiesToUpdate)
      const color = params.get(AnnotationEditorParamsType.FREETEXT_COLOR) as string
      const size = params.get(AnnotationEditorParamsType.FREETEXT_SIZE) as number
      const position = `${editor.pageIndex}:${editor.x}:${editor.y}`
      if (textSettings?.element === element) {
        const sameParams = textSettings.color === color && textSettings.size === size
        // PDF.js stores mutable editors without notifying storage on formatting or movement.
        if (!editor.isEmpty() && (!sameParams || textPosition !== position)) onDirtyChange(true)
        textPosition = position
        if (sameParams) return
      }
      textPosition = position
      const setParam = (type: number, value: string | number): void => {
        if (events.signal.aborted || !isActive() || !element.isConnected) return
        const current = new Map(editor.propertiesToUpdate).get(type)
        if (
          current === value ||
          (typeof current === 'string' &&
            typeof value === 'string' &&
            current.toLowerCase() === value.toLowerCase())
        )
          return
        editor.updateParams(type, value)
        updateTextEditor()
      }
      textSettings = {
        element,
        color,
        size,
        setColor: (color) => setParam(AnnotationEditorParamsType.FREETEXT_COLOR, color),
        setSize: (size) => setParam(AnnotationEditorParamsType.FREETEXT_SIZE, size)
      }
      onTextEditorChange(textSettings)
    })
  }
  events.on('annotationeditorparamschanged', updateTextEditor)
  events.on('editingstateschanged', updateTextEditor)
  for (const type of ['pointerup', 'keyup']) {
    window.addEventListener(
      type,
      () => {
        if (isActive() && textSettings?.element) updateTextEditor()
      },
      { signal: events.signal }
    )
  }
  container.addEventListener(
    'focusout',
    (event) => {
      // Toolbar formatting controls keep an empty text box alive while they have focus.
      if (
        event.target instanceof Element &&
        event.target.closest('.freeTextEditor') &&
        event.relatedTarget instanceof Element &&
        event.relatedTarget.closest('[data-text-settings]')
      )
        event.stopPropagation()
    },
    { capture: true, signal: events.signal }
  )
  events.on('annotationeditormodechanged', ({ mode }) => {
    if (mode === AnnotationEditorType.FREETEXT && !events.hasSelection()) {
      events.setParam(AnnotationEditorParamsType.FREETEXT_COLOR, defaults.color)
      events.setParam(AnnotationEditorParamsType.FREETEXT_SIZE, defaults.size)
    }
    updateTextEditor()
  })
  events.signal.addEventListener(
    'abort',
    () => {
      textSettings = null
    },
    { once: true }
  )
  container.addEventListener(
    'input',
    (event) => {
      if (event.target instanceof Element && event.target.closest('.freeTextEditor'))
        onDirtyChange(true)
    },
    { signal: events.signal }
  )
  return { refresh: updateTextEditor }
}
