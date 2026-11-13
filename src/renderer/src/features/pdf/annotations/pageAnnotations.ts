import type { PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Annotation, PdfRect } from './model'
import { annotationOrientation } from './geometry'
import { highlightPath } from './highlight/geometry'

export type PageAnnotations = {
  prepare(pageIndex: number): Promise<void>
  forPage(pageIndex: number): Iterable<Annotation>
  subscribe(pageIndex: number, listener: (baseChanged: boolean) => void): () => void
}

// Paint current annotations in viewport coordinates over a rendered PDF page.
export function paintAnnotations(
  context: CanvasRenderingContext2D,
  viewport: PageViewport,
  records: Iterable<Annotation>,
  clip?: PdfRect
): void {
  for (const record of records) {
    if (
      clip &&
      (record.rect[0] >= clip[2] ||
        record.rect[1] >= clip[3] ||
        record.rect[2] <= clip[0] ||
        record.rect[3] <= clip[1])
    )
      continue
    context.save()
    if (record.kind === 'highlight') {
      context.globalAlpha = record.opacity ?? 0.9
      context.globalCompositeOperation = 'multiply'
      const path = new Path2D(highlightPath(record, viewport))
      if (record.strokes) {
        context.strokeStyle = record.color
        context.lineWidth = record.thickness! * viewport.scale
        context.lineCap = context.lineJoin = 'round'
        context.stroke(path)
      } else {
        context.fillStyle = record.color
        context.fill(path)
      }
    } else {
      const [x1, y1] = viewport.convertToViewportPoint(record.rect[0], record.rect[1])
      const [x2, y2] = viewport.convertToViewportPoint(record.rect[2], record.rect[3])
      const left = Math.min(x1, x2),
        top = Math.min(y1, y2)
      const { width, height, x, y, angle } = annotationOrientation(
        record,
        viewport.rotation,
        viewport.scale
      )
      context.translate(left + x, top + y)
      context.rotate((angle * Math.PI) / 180)
      if (record.kind === 'image' && record.image) {
        context.drawImage(record.image.canvas, 0, 0, width, height)
      } else if (record.kind === 'text') {
        const size = record.fontSize! * viewport.scale
        const lines = record.textLines!
        const lineHeight = size * 1.35
        context.font = `${size}px Helvetica, Arial, sans-serif`
        context.fillStyle = record.color
        context.textBaseline = 'alphabetic'
        const metrics = context.measureText('Mg')
        const baseline =
          (lineHeight + metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2
        const start = 2 * viewport.scale
        lines.forEach((line, index) =>
          context.fillText(line, 2 * viewport.scale, start + baseline + index * lineHeight)
        )
      }
    }
    context.restore()
  }
}
