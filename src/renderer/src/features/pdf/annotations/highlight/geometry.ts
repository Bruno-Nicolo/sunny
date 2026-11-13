import type { PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Annotation } from '../model'

// Page overlays and canvas previews use the same viewport path, including single-point strokes.
export function highlightPath(record: Annotation, viewport: PageViewport): string {
  const path: string[] = []
  if (record.strokes) {
    for (const points of record.strokes) {
      for (let i = 0; i < points.length; i += 2) {
        const [x, y] = viewport.convertToViewportPoint(points[i], points[i + 1])
        path.push(`${i === 0 ? 'M' : 'L'}${x},${y}`)
        if (points.length === 2) path.push(`L${x},${y}`)
      }
    }
  } else {
    const points = record.quads!
    for (let i = 0; i < points.length; i += 8) {
      for (const offset of [0, 2, 6, 4]) {
        const [x, y] = viewport.convertToViewportPoint(points[i + offset], points[i + offset + 1])
        path.push(`${offset === 0 ? 'M' : 'L'}${x},${y}`)
      }
      path.push('Z')
    }
  }
  return path.join(' ')
}
