import { AnnotationType, OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { hexColor } from './pdfAnnotationWriter'
import type { Annotation, PdfRect } from './model'
import { layoutText } from './text/textLayout'

async function stampImages(
  page: PDFPageProxy,
  ids: Set<string>
): Promise<Map<string, HTMLCanvasElement>> {
  if (!ids.size) return new Map()
  const operators = await page.getOperatorList({ isEditing: true })
  const included = new Set<number>()
  let include = false
  for (let index = 0; index < operators.fnArray.length; index++) {
    if (operators.fnArray[index] === OPS.beginAnnotation)
      include = ids.has(operators.argsArray[index][0])
    if (include) included.add(index)
    if (operators.fnArray[index] === OPS.endAnnotation) include = false
  }
  const viewport = page.getViewport({ scale: 2, rotation: 0 })
  const canvas = window.document.createElement('canvas')
  // Stamp appearances render into their own canvases; the carrier never paints page content.
  canvas.width = canvas.height = 1
  const images = new Map<string, HTMLCanvasElement>()
  try {
    await page.render({
      canvas,
      viewport,
      isEditing: true,
      background: 'rgba(0,0,0,0)',
      annotationCanvasMap: images,
      operationsFilter: (index) => included.has(index)
    }).promise
  } finally {
    canvas.width = canvas.height = 0
  }
  return images
}

// Import only annotations that this editor can represent; leave all other PDF objects untouched.
export async function readPageAnnotations(page: PDFPageProxy): Promise<Annotation[]> {
  const pageIndex = page.pageNumber - 1
  const annotations = await page.getAnnotations()
  const imageIds = new Set<string>(
    annotations
      .filter((data) => data.annotationType === AnnotationType.STAMP && data.isEditable)
      .map((data) => data.id)
  )
  const images = await stampImages(page, imageIds)
  const records: Annotation[] = []
  for (const data of annotations) {
    if (
      !/^\d+R\d*$/.test(data.id) ||
      !data.isEditable ||
      data.annotationFlags & (1 | 2 | 8 | 16 | 32 | 64 | 128 | 512)
    )
      continue
    const common = {
      key: data.id,
      originalId: data.id,
      popupRef: data.popupRef,
      pageIndex,
      rect: data.rect.slice() as PdfRect,
      rotation: data.rotation ?? 0
    }
    let record: Annotation | undefined
    if (data.annotationType === AnnotationType.HIGHLIGHT && data.quadPoints?.length) {
      record = {
        ...common,
        kind: 'highlight',
        color: hexColor(data.color, '#ffff00'),
        opacity: data.opacity ?? 0.9,
        quads: Array.from(data.quadPoints)
      }
    } else if (data.annotationType === AnnotationType.INK && data.inkLists?.length) {
      record = {
        ...common,
        kind: 'highlight',
        color: hexColor(data.color, '#ffff00'),
        opacity: data.opacity ?? 1,
        thickness: data.borderStyle.rawWidth || 1,
        strokes: data.inkLists.map((points: ArrayLike<number>) => Array.from(points))
      }
    } else if (
      data.annotationType === AnnotationType.FREETEXT &&
      data.textContent?.join('\n').trim()
    ) {
      const fontName = data.defaultAppearanceData?.fontName ?? ''
      record = layoutText(
        {
          ...common,
          kind: 'text',
          textResized: data.textResized,
          color: hexColor(data.defaultAppearanceData?.fontColor, '#000000'),
          fontSize: data.defaultAppearanceData?.fontSize || 16,
          fontFamily: /Cour/i.test(fontName)
            ? 'monospace'
            : /TiRo|Times/i.test(fontName)
              ? 'serif'
              : 'sans-serif',
          textAlign:
            data.textAlignment === 1 ? 'center' : data.textAlignment === 2 ? 'right' : 'left'
        },
        data.contentsObj?.str || data.textContent.join('\n')
      )
      record.rect = common.rect
    } else if (data.annotationType === AnnotationType.STAMP && images.has(data.id)) {
      record = {
        ...common,
        kind: 'image',
        color: '#000000',
        image: { id: data.id, canvas: images.get(data.id)!, rotation: 0 }
      }
    }
    if (record) records.push(record)
  }
  const used = new Set<HTMLCanvasElement>()
  for (const record of records) if (record.kind === 'image') used.add(record.image.canvas)
  for (const image of images.values()) if (!used.has(image)) image.width = image.height = 0
  return records
}
