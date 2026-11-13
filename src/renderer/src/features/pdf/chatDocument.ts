import {
  AnnotationMode,
  type PDFDocumentProxy,
  type PDFPageProxy
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { ChatDocument, DocumentSource, PdfRect } from '../../../../shared/ai'
import type { Annotation } from './annotations/model'
import { paintAnnotations } from './annotations/pageAnnotations'

export type IndexedPdf = Omit<ChatDocument, 'path' | 'name'>

export function itemRect(item: TextItem, ascent = 0.8, descent = -0.2): PdfRect {
  const [a, b, , , x, y] = item.transform
  const length = Math.hypot(a, b) || 1
  const ux = a / length,
    uy = b / length
  const height = item.height || length
  const points = [
    [x - uy * height * ascent, y + ux * height * ascent],
    [x - uy * height * descent, y + ux * height * descent],
    [x + ux * item.width - uy * height * ascent, y + uy * item.width + ux * height * ascent],
    [x + ux * item.width - uy * height * descent, y + uy * item.width + ux * height * descent]
  ]
  return [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1]))
  ]
}
export async function pageSources(page: PDFPageProxy): Promise<DocumentSource[]> {
  const content = await page.getTextContent()
  const result: DocumentSource[] = []
  let text = '',
    rects: PdfRect[] = []
  const flush = (): void => {
    if (text.trim())
      result.push({
        id: `p${page.pageNumber}s${result.length + 1}`,
        page: page.pageNumber,
        text: text.trim(),
        rects
      })
    text = ''
    rects = []
  }
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    if (text.length + item.str.length > 900 && text) flush()
    const style = content.styles[item.fontName]
    for (let offset = 0; offset < item.str.length; offset += 7000) {
      text += item.str.slice(offset, offset + 7000) + (item.hasEOL ? '\n' : ' ')
      rects.push(itemRect(item, style?.ascent, style?.descent))
      if (text.length > 900) flush()
    }
  }
  flush()
  return result
}

async function digest(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Index only on demand. Hash original page appearance and text independently of annotations. */
export async function indexPdf(
  document: PDFDocumentProxy,
  signal: AbortSignal,
  progress: (page: number, total: number) => void,
  release: (page: PDFPageProxy) => void
): Promise<IndexedPdf> {
  const sources: DocumentSource[] = []
  const hashes: string[] = []
  for (let number = 1; number <= document.numPages; number++) {
    signal.throwIfAborted()
    const page = await document.getPage(number)
    const canvas = window.document.createElement('canvas')
    try {
      const chunks = await pageSources(page)
      sources.push(...chunks)
      const original = page.getViewport({ scale: 1, rotation: 0 })
      const scale = Math.min(1, Math.sqrt(4_000_000 / (original.width * original.height)))
      const viewport = page.getViewport({ scale, rotation: 0 })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const task = page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE })
      const cancel = (): void => task.cancel()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await task.promise
      } finally {
        signal.removeEventListener('abort', cancel)
      }
      const context = canvas.getContext('2d')!
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      hashes.push(await digest(new Uint8Array(pixels.data.buffer)))
      hashes.push(
        await digest(new TextEncoder().encode(JSON.stringify({ view: page.view, sources: chunks })))
      )
      progress(number, document.numPages)
    } finally {
      canvas.width = canvas.height = 0
      release(page)
    }
    // Yield between pages to keep document navigation responsive.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  signal.throwIfAborted()
  return {
    version: await digest(new TextEncoder().encode(hashes.join(''))),
    pages: document.numPages,
    sources
  }
}

export async function regionText(page: PDFPageProxy, rect: PdfRect): Promise<string> {
  const content = await page.getTextContent()
  let text = ''
  for (const item of content.items) {
    if (!('str' in item)) continue
    const style = content.styles[item.fontName]
    const bounds = itemRect(item, style?.ascent, style?.descent)
    // Partial text items stay in the image; do not send text outside the selected rectangle.
    if (
      bounds[0] >= rect[0] &&
      bounds[1] >= rect[1] &&
      bounds[2] <= rect[2] &&
      bounds[3] <= rect[3]
    )
      text += item.str + (item.hasEOL ? '\n' : ' ')
  }
  return text.trim()
}

/** Render a PDF crop with current annotations, without editor controls or selection overlays. */
export async function regionImage(
  page: PDFPageProxy,
  rect: PdfRect,
  rotation: number,
  annotations: Iterable<Annotation>,
  signal: AbortSignal
): Promise<string> {
  signal.throwIfAborted()
  const base = page.getViewport({ scale: 1, rotation })
  const [x1, y1] = base.convertToViewportPoint(rect[0], rect[1])
  const [x2, y2] = base.convertToViewportPoint(rect[2], rect[3])
  const width = Math.abs(x2 - x1),
    height = Math.abs(y2 - y1)
  const scale = Math.min(2, 1600 / Math.max(width, height))
  const viewport = base.clone({
    scale,
    offsetX: -Math.min(x1, x2) * scale,
    offsetY: -Math.min(y1, y2) * scale
  })
  const canvas = window.document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const task = page.render({
    canvas,
    viewport,
    annotationMode: AnnotationMode.ENABLE_STORAGE
  })
  const cancel = (): void => task.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await task.promise
    signal.throwIfAborted()
    const context = canvas.getContext('2d')!
    paintAnnotations(context, viewport, annotations, rect)
    return canvas.toDataURL('image/png')
  } finally {
    signal.removeEventListener('abort', cancel)
    canvas.width = canvas.height = 0
  }
}
