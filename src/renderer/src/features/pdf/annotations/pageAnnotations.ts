import type { PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Annotation, PdfRect } from './model'
import { annotationOrientation } from './geometry'

export type PageAnnotations = {
  prepare(pageIndex: number): Promise<void>
  forPage(pageIndex: number): Iterable<Annotation>
  subscribe(pageIndex: number, listener: (baseChanged: boolean) => void): () => void
}

const quadCorners = [0, 2, 6, 4]

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
      context.globalCompositeOperation = 'multiply'
      context.globalAlpha = record.opacity ?? 0.9
      context.fillStyle = record.color
      context.beginPath()
      const points = record.quads!
      for (let i = 0; i < points.length; i += 8) {
        for (let corner = 0; corner < quadCorners.length; corner++) {
          const offset = quadCorners[corner]
          const [x, y] = viewport.convertToViewportPoint(points[i + offset], points[i + offset + 1])
          if (corner === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        }
        context.closePath()
      }
      context.fill()
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
        const lines = (record.text ?? '').split('\n')
        const lineHeight = size * 1.35
        context.font = `${size}px Helvetica, Arial, sans-serif`
        context.fillStyle = record.color
        context.textBaseline = 'alphabetic'
        const metrics = context.measureText('Mg')
        const baseline =
          (lineHeight + metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2
        const start = (height - lines.length * lineHeight) / 2
        lines.forEach((line, index) =>
          context.fillText(line, 2 * viewport.scale, start + baseline + index * lineHeight)
        )
      }
    }
    context.restore()
  }
}
