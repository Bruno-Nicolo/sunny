import type { Annotation } from '../model'
import type { HighlightStyle } from '../types'

// Change appearance without copying stroke points; only a size change adjusts the bounds.
export function updateHighlightStyle(
  record: Annotation,
  style: Partial<HighlightStyle>
): Annotation {
  const color = style.color ?? record.color
  const opacity = style.opacity ?? record.opacity
  const thickness = record.strokes ? (style.thickness ?? record.thickness) : record.thickness
  if (color === record.color && opacity === record.opacity && thickness === record.thickness)
    return record

  let rect = record.rect
  if (thickness !== record.thickness) {
    const padding = (thickness! - (record.thickness ?? 0)) / 2
    rect = [rect[0] - padding, rect[1] - padding, rect[2] + padding, rect[3] + padding]
  }
  return { ...record, color, opacity, thickness, rect }
}
