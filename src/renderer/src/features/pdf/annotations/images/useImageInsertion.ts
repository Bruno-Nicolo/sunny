import { useCallback, useEffect, type DragEvent } from 'react'
import type { PdfDocumentHandle } from '../../types'
import type { AnnotationTool } from '../types'
import { supportedImageMimeTypes } from './imageFiles'

type Options = {
  enabled: boolean
  getActiveViewer(): PdfDocumentHandle | undefined
  onToolChange(tool: AnnotationTool): void
  onError(message: string): void
}

// Route file input, clipboard and drop insertion to the active document only.
export function useImageInsertion({ enabled, getActiveViewer, onToolChange, onError }: Options): {
  addImages(files: File[]): Promise<void>
  onImageDrop(event: DragEvent<HTMLElement>): void
} {
  const addImages = useCallback(
    async (files: File[]): Promise<void> => {
      const viewer = getActiveViewer()
      if (!enabled || !viewer) return
      onToolChange('none')
      try {
        for (const file of files) await viewer.addImage(file)
      } catch (error) {
        onError(error instanceof Error ? error.message : 'The image could not be added.')
      }
    },
    [enabled, getActiveViewer, onToolChange, onError]
  )

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        supportedImageMimeTypes.includes(file.type)
      )
      if (!files.length) return
      // Capture image pastes before PDF.js's document listeners in the other tabs.
      event.stopImmediatePropagation()
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable], [role="dialog"]')
      )
        return
      event.preventDefault()
      if (enabled) void addImages(files)
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  }, [enabled, addImages])

  const onImageDrop = (event: DragEvent<HTMLElement>): void => {
    const files = Array.from(event.dataTransfer.files).filter((file) =>
      supportedImageMimeTypes.includes(file.type)
    )
    if (!files.length) return
    event.preventDefault()
    event.stopPropagation()
    if (enabled) void addImages(files)
  }

  return { addImages, onImageDrop }
}
