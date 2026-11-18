import type { PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Annotation, PdfRect } from '../model'
import type { HighlightStyle } from '../types'

// Keep unfinished gestures out of document history; append preview points without rebuilding the path.
export function drawHighlight({
  event,
  element,
  viewport,
  pageIndex,
  color,
  opacity,
  thickness,
  signal,
  complete
}: HighlightStyle & {
  event: PointerEvent
  element: HTMLElement
  viewport: PageViewport
  pageIndex: number
  signal: AbortSignal
  complete(record: Annotation): void
}): () => void {
  const lifetime = new AbortController()
  const combined = AbortSignal.any([signal, lifetime.signal])
  const points: number[] = []
  const rect: PdfRect = [Infinity, Infinity, -Infinity, -Infinity]
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('lepisFreehandPreview')
  svg.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`)
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  line.classList.add('lepisFreehandStroke')
  line.setAttribute('stroke', color)
  line.setAttribute('stroke-width', String(thickness * viewport.scale))
  line.setAttribute('opacity', String(opacity))
  svg.append(line)
  element.append(svg)
  const cancel = (): void => lifetime.abort()
  combined.addEventListener('abort', () => svg.remove(), { once: true })

  const appendPoint = (x: number, y: number): void => {
    const point = svg.createSVGPoint()
    point.x = x
    point.y = y
    line.points.appendItem(point)
  }
  const add = (input: PointerEvent, bounds: DOMRect): void => {
    const x = Math.max(0, Math.min(viewport.width, input.clientX - bounds.left))
    const y = Math.max(0, Math.min(viewport.height, input.clientY - bounds.top))
    const [px, py] = viewport.convertToPdfPoint(x, y)
    if (points.length && Math.hypot(px - points.at(-2)!, py - points.at(-1)!) < 0.5) return
    points.push(px, py)
    rect[0] = Math.min(rect[0], px - thickness / 2)
    rect[1] = Math.min(rect[1], py - thickness / 2)
    rect[2] = Math.max(rect[2], px + thickness / 2)
    rect[3] = Math.max(rect[3], py + thickness / 2)
    appendPoint(x, y)
    if (points.length === 2) appendPoint(x, y)
  }
  add(event, element.getBoundingClientRect())
  window.addEventListener(
    'pointermove',
    (move) => {
      if (move.pointerId !== event.pointerId) return
      const bounds = element.getBoundingClientRect()
      for (const sample of move.getCoalescedEvents()) add(sample, bounds)
      add(move, bounds)
    },
    { signal: combined }
  )
  window.addEventListener(
    'pointerup',
    (up) => {
      if (up.pointerId !== event.pointerId) return
      add(up, element.getBoundingClientRect())
      cancel()
      complete({
        key: crypto.randomUUID(),
        kind: 'highlight',
        pageIndex,
        rotation: 0,
        color,
        opacity,
        thickness,
        strokes: [points],
        rect
      })
    },
    { signal: combined }
  )
  window.addEventListener(
    'pointercancel',
    (cancelled) => {
      if (cancelled.pointerId === event.pointerId) cancel()
    },
    { signal: combined }
  )
  window.addEventListener('blur', cancel, { signal: combined })
  window.addEventListener(
    'keydown',
    (key) => {
      if (key.key === 'Escape') cancel()
    },
    { signal: combined }
  )
  return cancel
}
