import { AnnotationMode, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfCopyDestination } from '../../../../shared/contracts'

const printScale = 150 / 72
let printing = false

async function renderPrintPages(
  data: Uint8Array,
  password: string | undefined,
  container: HTMLDivElement,
  style: HTMLStyleElement,
  intent: 'display' | 'print'
): Promise<void> {
  const task = getDocument({ data, password })
  const pageStyles: string[] = []
  try {
    const pdf = await task.promise
    const annotationMode =
      intent === 'display' ? AnnotationMode.ENABLE_STORAGE : AnnotationMode.ENABLE
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const viewport = page.getViewport({ scale: printScale })
      const width = viewport.width / printScale
      const height = viewport.height / printScale
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport, intent, annotationMode }).promise
      canvas.style.width = `${width}pt`
      canvas.style.height = `${height}pt`
      // Chromium applies the named page size to the block that contains the canvas.
      const sheet = document.createElement('div')
      sheet.style.page = `pdf-page-${number}`
      sheet.append(canvas)
      container.append(sheet)
      pageStyles.push(`@page pdf-page-${number} { size: ${width}pt ${height}pt; margin: 0; }`)
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  style.textContent = `
    #pdf-print { display: none; }
    @media print {
      ${pageStyles.join('\n')}
      html, body { height: auto !important; overflow: visible !important; background: white !important; }
      body > :not(#pdf-print) { display: none !important; }
      #pdf-print { display: block; }
      #pdf-print > div { break-after: page; }
      #pdf-print > div:last-child { break-after: auto; }
      #pdf-print canvas { display: block; max-width: none; }
    }
  `
}

async function openPrintDialog(): Promise<void> {
  const completed = Promise.withResolvers<void>()
  const afterPrint = (): void => completed.resolve()
  window.addEventListener('afterprint', afterPrint, { once: true })
  try {
    window.print()
    await completed.promise
  } finally {
    window.removeEventListener('afterprint', afterPrint)
  }
}

// Both output modes use an isolated snapshot so pending edits appear on the pages.
export async function printPdf(
  snapshot: () => Promise<Uint8Array>,
  password: string | undefined,
  destination?: PdfCopyDestination
): Promise<boolean> {
  if (printing) return false
  printing = true
  const container = document.createElement('div')
  container.id = 'pdf-print'
  const style = document.createElement('style')
  try {
    if (destination && !(await window.lepis.chooseFlattenedCopy(destination))) return false
    let rendered = false
    try {
      await renderPrintPages(
        await snapshot(),
        password,
        container,
        style,
        destination ? 'display' : 'print'
      )
      document.head.append(style)
      document.body.append(container)
      rendered = true
    } finally {
      if (destination) await window.lepis.finishFlattenedCopy(rendered)
    }
    if (!destination) await openPrintDialog()
    return true
  } finally {
    container.remove()
    style.remove()
    printing = false
  }
}
