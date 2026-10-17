import type { Annotation, PdfRect } from './model'

// Text grows along its saved orientation, independently of the current page rotation.
export function textRect(record: Annotation, width: number, height: number): PdfRect {
  const [x1, y1, x2, y2] = record.rect
  switch (record.rotation) {
    case 90:
      return [x1, y1, x1 + height, y1 + width]
    case 180:
      return [x2 - width, y1, x2, y1 + height]
    case 270:
      return [x2 - height, y2 - width, x2, y2]
    default:
      return [x1, y2 - height, x1 + width, y2]
  }
}

export function normalizedRect(first: number[], second: number[]): PdfRect {
  return [
    Math.min(first[0], second[0]),
    Math.min(first[1], second[1]),
    Math.max(first[0], second[0]),
    Math.max(first[1], second[1])
  ]
}
