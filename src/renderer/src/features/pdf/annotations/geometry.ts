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

// Orient text and image content inside its axis-aligned page bounds.
export function annotationOrientation(
  record: Annotation,
  rotation: number,
  scale: number
): { angle: number; width: number; height: number; x: number; y: number } {
  const intrinsic = record.kind === 'text' ? record.rotation : (record.image?.rotation ?? 0)
  const angle = (rotation - intrinsic + 360) % 360
  const width =
    (intrinsic % 180 ? record.rect[3] - record.rect[1] : record.rect[2] - record.rect[0]) * scale
  const height =
    (intrinsic % 180 ? record.rect[2] - record.rect[0] : record.rect[3] - record.rect[1]) * scale
  return {
    angle,
    width,
    height,
    x: angle === 90 ? height : angle === 180 ? width : 0,
    y: angle === 180 ? height : angle === 270 ? width : 0
  }
}
