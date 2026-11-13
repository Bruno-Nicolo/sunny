import { useCallback, useEffect, useRef, type DragEvent } from 'react'
import type { PdfDocumentHandle } from '../types'
import type { AnnotationInsertionPoint, AnnotationTool } from './types'

type Options = {
  enabled: boolean
  getActiveViewer(): PdfDocumentHandle | undefined
  onToolChange(tool: AnnotationTool): void
  onError(message: string): void
}

// Route file input, clipboard and drop insertion to the active document only.
export function useAnnotationInsertion({
  enabled,
  getActiveViewer,
  onToolChange,
  onError
}: Options): {
  addImages(files: File[]): Promise<void>
  onImageDrop(event: DragEvent<HTMLElement>): void
} {
  const pointer = useRef<AnnotationInsertionPoint | undefined>(undefined)
  const insert = useCallback(
    async (content: File[] | string, point?: AnnotationInsertionPoint): Promise<void> => {
      const viewer = getActiveViewer()
      if (!enabled || !viewer) return
      onToolChange('none')
      try {
        if (typeof content === 'string') await viewer.addText(content, point)
        else for (const file of content) await viewer.addImage(file, point)
      } catch (error) {
        onError(error instanceof Error ? error.message : 'The annotation could not be added.')
      }
    },
    [enabled, getActiveViewer, onToolChange, onError]
  )

  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      pointer.current = { clientX: event.clientX, clientY: event.clientY }
    }
    const onPaste = (event: ClipboardEvent): void => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith('image/')
      )
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!files.length && !text.trim()) return
      // Capture annotation pastes before PDF.js's document listeners in the other tabs.
      event.stopImmediatePropagation()
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]'
        )
      )
        return
      event.preventDefault()
      void insert(files.length ? files : text, pointer.current)
    }
    window.addEventListener('pointermove', onPointer, true)
    window.addEventListener('paste', onPaste, true)
    return () => {
      window.removeEventListener('pointermove', onPointer, true)
      window.removeEventListener('paste', onPaste, true)
    }
  }, [insert])

  const onImageDrop = (event: DragEvent<HTMLElement>): void => {
    const files = Array.from(event.dataTransfer.files).filter((file) =>
      file.type.startsWith('image/')
    )
    if (!files.length) return
    event.preventDefault()
    event.stopPropagation()
    void insert(files)
  }

  return { addImages: insert, onImageDrop }
}
