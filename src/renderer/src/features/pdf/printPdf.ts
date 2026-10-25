import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

let printing = false

// Render a saved snapshot so printing includes pending edits without changing the file on disk.
export async function printPdf(
  snapshot: () => Promise<Uint8Array>,
  password?: string
): Promise<void> {
  if (printing) return
  printing = true
  const container = document.createElement('div')
  container.id = 'pdf-print'
  const style = document.createElement('style')
  const completed = Promise.withResolvers<void>()
  const afterPrint = (): void => completed.resolve()
  let task: ReturnType<typeof getDocument> | undefined
  try {
    task = getDocument({ data: await snapshot(), password })
    const pdf = await task.promise
    const pageStyles: string[] = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const size = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 150 / 72 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport, intent: 'print' }).promise
      canvas.style.width = `${size.width}pt`
      canvas.style.height = `${size.height}pt`
      const sheet = document.createElement('div')
      sheet.style.page = `pdf-page-${number}`
      sheet.append(canvas)
      container.append(sheet)
      pageStyles.push(
        `@page pdf-page-${number} { size: ${size.width}pt ${size.height}pt; margin: 0; }`
      )
      page.cleanup()
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
    document.head.append(style)
    document.body.append(container)
    window.addEventListener('afterprint', afterPrint, { once: true })
    window.print()
    await completed.promise
  } finally {
    window.removeEventListener('afterprint', afterPrint)
    container.remove()
    style.remove()
    try {
      await task?.destroy()
    } finally {
      printing = false
    }
  }
}
