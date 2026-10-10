import type { EventBus, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import type { AnnotationEditor } from 'pdfjs-dist/types/src/display/editor/editor'
import type { AnnotationEditorUIManager } from 'pdfjs-dist/types/src/display/editor/tools'

type EditorModeOptions = PDFViewer['annotationEditorMode']

type EditorEventMap = {
  annotationeditoruimanager: { uiManager: AnnotationEditorUIManager }
  annotationeditormodechanged: { mode: number }
  switchannotationeditormode: EditorModeOptions
  annotationeditorparamschanged: { source: AnnotationEditorUIManager }
  editingstateschanged: { source: AnnotationEditorUIManager }
}

type Options = {
  eventBus: Pick<EventBus, 'on' | 'off' | 'dispatch'>
  viewer: Pick<PDFViewer, 'annotationEditorMode'>
  signal: AbortSignal
}

export type EditorEvents = {
  readonly signal: AbortSignal
  on<K extends keyof EditorEventMap>(
    name: K,
    listener: (event: EditorEventMap[K]) => void
  ): () => void
  setMode(options: EditorModeOptions): void
  getSelectedEditor(): AnnotationEditor | null
  getActiveEditor(): AnnotationEditor | null
  hasSelection(): boolean
  setParam(type: number, value: string | number | { bitmapFile: File }): void
  runHistoryAction(name: 'undo' | 'redo'): void
  commit(): void
  enterMode(mode: number): Promise<void>
}

// Keep PDF.js event names, subscriptions and asynchronous mode changes at this boundary.
export function createEditorEvents({ eventBus, viewer, signal }: Options): EditorEvents {
  let mode: number | null = null
  let manager: AnnotationEditorUIManager | null = null
  const on = <K extends keyof EditorEventMap>(
    name: K,
    listener: (event: EditorEventMap[K]) => void
  ): (() => void) => {
    eventBus.on(name, listener, { signal })
    return () => eventBus.off(name, listener)
  }
  on('annotationeditoruimanager', ({ uiManager }) => {
    manager = uiManager
  })
  on('annotationeditormodechanged', (event) => {
    mode = event.mode
  })
  signal.addEventListener(
    'abort',
    () => {
      manager = null
    },
    { once: true }
  )

  const setMode = (options: EditorModeOptions): void => {
    if (!signal.aborted) viewer.annotationEditorMode = options
  }
  const getSelectedEditor = (): AnnotationEditor | null => manager?.firstSelectedEditor ?? null
  const getActiveEditor = (): AnnotationEditor | null => manager?.getActive() ?? null

  return {
    signal,
    on,
    setMode,
    getSelectedEditor,
    getActiveEditor,
    hasSelection: () => manager?.hasSelection ?? false,
    setParam(type: number, value: string | number | { bitmapFile: File }): void {
      if (!signal.aborted)
        eventBus.dispatch('switchannotationeditorparams', { source: null, type, value })
    },
    runHistoryAction(name: 'undo' | 'redo'): void {
      if (!signal.aborted) eventBus.dispatch('editingaction', { source: null, name })
    },
    commit(): void {
      if (!signal.aborted) (getActiveEditor() ?? getSelectedEditor())?.commitOrRemove()
    },
    async enterMode(requestedMode: number): Promise<void> {
      const interrupted = (): Error => new Error('Annotation editing was interrupted. Try again.')
      if (signal.aborted) throw interrupted()
      if (mode === requestedMode) return
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          clearTimeout(timer)
          unsubscribe()
          signal.removeEventListener('abort', onAbort)
        }
        const unsubscribe = on('annotationeditormodechanged', ({ mode }) => {
          cleanup()
          if (mode === requestedMode) resolve()
          else reject(interrupted())
        })
        const onAbort = (): void => {
          cleanup()
          reject(interrupted())
        }
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('The annotation editor is not ready. Try again.'))
        }, 10000)
        signal.addEventListener('abort', onAbort, { once: true })
        try {
          setMode({ mode: requestedMode })
        } catch (error) {
          cleanup()
          reject(error)
        }
      })
    }
  }
}
