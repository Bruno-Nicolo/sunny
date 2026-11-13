import type { Annotation } from '../model'
import { annotationOrientation, textRect } from '../geometry'

let context: CanvasRenderingContext2D | null = null
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function wrapLines(
  paragraphs: string[],
  width: number,
  context: CanvasRenderingContext2D
): string[] {
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    let line = ''
    for (const word of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
      if (context.measureText((line + word).trimEnd()).width <= width) {
        line += word
        continue
      }
      if (line) lines.push(line.trimEnd())
      line = ''
      if (context.measureText(word.trimEnd()).width <= width) {
        line = word
        continue
      }
      for (const { segment } of graphemes.segment(word)) {
        if (line && context.measureText(line + segment).width > width) {
          lines.push(line)
          line = ''
        }
        line += segment
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

// Cache visual lines for PDF output and thumbnails; keep soft wraps out of editable text.
export function layoutText(record: Annotation, text: string): Annotation {
  const canvas = (context ??= document.createElement('canvas').getContext('2d')!)
  canvas.font = `${record.fontSize}px Helvetica, Arial, sans-serif`
  const size = annotationOrientation(record, record.rotation, 1)
  const paragraphs = text.split('\n')
  let width = Math.max(record.fontSize! * 2 + 4, size.width)
  if (!record.textResized) {
    width = 20
    for (const line of paragraphs) width = Math.max(width, canvas.measureText(line).width + 4)
  }
  const lines = record.textResized ? wrapLines(paragraphs, width - 4, canvas) : paragraphs
  const height = Math.max(
    record.textResized ? size.height : 0,
    lines.length * record.fontSize! * 1.35 + 4
  )
  return { ...record, text, textLines: lines, rect: textRect(record, width, height) }
}
