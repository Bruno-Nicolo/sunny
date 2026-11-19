import { SignatureExtractor } from 'pdfjs-dist/legacy/build/pdf.mjs'

export type SignatureStroke = { points: number[]; thickness: number; path?: Path2D }
export type SignatureCrop = { left: number; top: number; right: number; bottom: number }
export const fullSignatureCrop: SignatureCrop = { left: 0, top: 0, right: 100, bottom: 100 }
export const signatureImageTypes = ['image/png', 'image/jpeg', 'image/webp']
export const maxSignatureImageMB = 20

function signatureCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

// Reuse the paths of completed strokes when drawing a new stroke or replaying history.
export function paintSignature(canvas: HTMLCanvasElement, strokes: SignatureStroke[]): void {
  const context = canvas.getContext('2d')!
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.lineCap = context.lineJoin = 'round'
  context.strokeStyle = '#000000'
  for (const stroke of strokes) {
    if (stroke.points.length === 2) {
      paintDot(context, stroke)
      continue
    }
    stroke.path ??= strokePath(stroke, canvas.width, canvas.height)
    if (!stroke.path) continue
    context.lineWidth = stroke.thickness
    context.stroke(stroke.path)
  }
}

function paintDot(context: CanvasRenderingContext2D, { points, thickness }: SignatureStroke): void {
  context.fillStyle = '#000000'
  context.beginPath()
  context.arc(points[0], points[1], thickness / 2, 0, 2 * Math.PI)
  context.fill()
}

// Draw only the new segments until the gesture is committed as a PDF.js path.
export function paintLiveStroke(
  canvas: HTMLCanvasElement,
  stroke: SignatureStroke,
  from: number
): void {
  const context = canvas.getContext('2d')!
  const { points, thickness } = stroke
  if (points.length === 2) {
    paintDot(context, stroke)
    return
  }
  context.strokeStyle = '#000000'
  context.lineCap = context.lineJoin = 'round'
  context.lineWidth = thickness
  const start = Math.max(0, from - 2)
  context.beginPath()
  context.moveTo(points[start], points[start + 1])
  for (let i = start + 2; i < points.length; i += 2) context.lineTo(points[i], points[i + 1])
  context.stroke()
}

function strokePath(stroke: SignatureStroke, width: number, height: number): Path2D | undefined {
  const result = SignatureExtractor.processDrawnLines({
    lines: {
      curves: [{ points: stroke.points }],
      width,
      height,
      thickness: stroke.thickness
    },
    pageWidth: width,
    pageHeight: height,
    rotation: 0,
    innerMargin: 0,
    mustSmooth: false,
    areContours: false
  })
  if (!result) return undefined
  // PDF.js emits SVG coordinates in a 10,000-unit viewBox on each axis.
  const path = new Path2D(result.outline.toSVGPath())
  const matrix = new DOMMatrix().scale(width / 10000, height / 10000)
  const scaled = new Path2D()
  scaled.addPath(path, matrix)
  return scaled
}

export function trimSignature(
  source: HTMLCanvasElement | OffscreenCanvas
): HTMLCanvasElement | null {
  const { width, height } = source
  const pixels = source.getContext('2d')!.getImageData(0, 0, width, height).data
  let left = width,
    top = height,
    right = -1,
    bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] < 8) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left) return null
  const margin = 4
  const canvas = signatureCanvas(right - left + 1 + margin * 2, bottom - top + 1 + margin * 2)
  canvas
    .getContext('2d')!
    .drawImage(
      source,
      left,
      top,
      right - left + 1,
      bottom - top + 1,
      margin,
      margin,
      right - left + 1,
      bottom - top + 1
    )
  return canvas
}

export async function importSignatureImage(file: File): Promise<HTMLCanvasElement> {
  if (!signatureImageTypes.includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.')
  if (file.size > maxSignatureImageMB * 1024 * 1024)
    throw new Error(`Choose an image up to ${maxSignatureImageMB} MB.`)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('The image could not be opened.')
  }
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = signatureCanvas(bitmap.width * scale, bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    bitmap.close()
  }
}

// Crop first so extraction considers only the selected signature, not the rest of the photo.
export function prepareSignatureImage(
  source: HTMLCanvasElement,
  crop: SignatureCrop,
  removeBackground: boolean
): HTMLCanvasElement | null {
  const left = (source.width * crop.left) / 100,
    top = (source.height * crop.top) / 100
  const width = (source.width * (crop.right - crop.left)) / 100
  const height = (source.height * (crop.bottom - crop.top)) / 100
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height))
  )
  const context = canvas.getContext('2d')!
  context.drawImage(source, left, top, width, height, 0, 0, canvas.width, canvas.height)
  if (removeBackground) {
    const bitmap = canvas.transferToImageBitmap()
    try {
      const result = SignatureExtractor.process(bitmap, canvas.width, canvas.height, 0, 0)
      if (!result) return null
      context.scale(canvas.width / 10000, canvas.height / 10000)
      context.fill(new Path2D(result.outline.toSVGPath()), 'evenodd')
    } finally {
      bitmap.close()
    }
  }
  return trimSignature(canvas)
}
