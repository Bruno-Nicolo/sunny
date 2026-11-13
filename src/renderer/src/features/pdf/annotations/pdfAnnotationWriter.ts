import { AnnotationEditorType, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Annotation, AnnotationModel } from './model'

const prefix = 'pdfjs_internal_editor_lepis_'

export function rgbBytes(color: string): number[] {
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16))
}

export function hexColor(color: ArrayLike<number> | null | undefined, fallback: string): string {
  return color
    ? `#${Array.from(color)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')}`
    : fallback
}

function serialize(record: Annotation): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: record.originalId,
    popupRef: record.popupRef,
    pageIndex: record.pageIndex,
    rect: record.rect.slice(),
    rotation: record.rotation,
    color: rgbBytes(record.color)
  }
  switch (record.kind) {
    case 'text':
      return {
        ...data,
        annotationType: AnnotationEditorType.FREETEXT,
        fontSize: record.fontSize,
        value: record.text,
        textLines: record.textLines,
        textResized: !!record.textResized
      }
    case 'highlight': {
      if (record.strokes) {
        return {
          ...data,
          annotationType: AnnotationEditorType.INK,
          opacity: record.opacity ?? 0.9,
          thickness: record.thickness,
          paths: {
            points: record.strokes,
            lines: record.strokes.map((points) => {
              const line: number[] = []
              for (let i = 0; i < points.length; i += 2)
                line.push(NaN, NaN, NaN, NaN, points[i], points[i + 1])
              return line
            })
          }
        }
      }
      const quads = record.quads!
      const outlines: number[][] = []
      for (let i = 0; i < quads.length; i += 8) {
        outlines.push([
          quads[i],
          quads[i + 1],
          quads[i + 2],
          quads[i + 3],
          quads[i + 6],
          quads[i + 7],
          quads[i + 4],
          quads[i + 5]
        ])
      }
      return {
        ...data,
        annotationType: AnnotationEditorType.HIGHLIGHT,
        opacity: record.opacity ?? 0.9,
        quadPoints: quads,
        outlines
      }
    }
    case 'image':
      return { ...data, annotationType: AnnotationEditorType.STAMP }
  }
}

// Keep PDF.js's incremental writer and original object references; bitmaps are fresh transfer copies.
export async function writeAnnotations(
  document: PDFDocumentProxy,
  model: AnnotationModel
): Promise<Uint8Array> {
  const storage = document.annotationStorage
  const clearSerializedAnnotations = (): void => {
    for (const [key] of [...storage]) {
      if (key.startsWith(prefix)) storage.remove(key)
    }
  }
  clearSerializedAnnotations()
  const records = new Map(model.records)
  const originals = new Map(model.originals)
  const bitmaps: ImageBitmap[] = []
  try {
    for (const original of originals.values()) {
      if (!records.has(original.key)) {
        storage.setValue(prefix + original.key, {
          id: original.originalId,
          pageIndex: original.pageIndex,
          popupRef: original.popupRef,
          deleted: true
        })
      }
    }
    for (const record of records.values()) {
      if (originals.get(record.key) === record) continue
      const data = serialize(record)
      if (record.kind === 'image' && !record.originalId) {
        const bitmap = await createImageBitmap(record.image!.canvas)
        bitmaps.push(bitmap)
        data.bitmapId = record.image!.id
        data.bitmap = bitmap
      }
      storage.setValue(prefix + record.key, data)
    }
    return await document.saveDocument()
  } finally {
    for (const bitmap of bitmaps) bitmap.close()
    clearSerializedAnnotations()
  }
}
