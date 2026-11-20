import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import electron from 'electron'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createPdf } from './fixtures/pdf.mjs'

const content = 'BT /F1 24 Tf 72 700 Td (Page content) Tj ET'
const annotatedPdf = createPdf([
  '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [9 0 R] /DA (/F1 12 Tf 0 g) /DR << /Font << /F1 5 0 R >> >> >> >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [6 0 R 7 0 R 8 0 R 9 0 R] >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Type /Annot /Subtype /Text /Rect [20 730 40 750] /Contents (Saved comment) /Popup 7 0 R >>',
  '<< /Type /Annot /Subtype /Popup /Rect [40 730 160 750] /Parent 6 0 R >>',
  '<< /Type /Annot /Subtype /Link /Rect [60 680 190 720] /A << /S /URI /URI (https://example.com/) >> >>',
  '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Name) /V (Saved form value) /Rect [60 615 200 650] /P 3 0 R >>'
])

const { app, BrowserWindow, dialog, Menu } = electron
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sunny-flattened-'))
const source = path.join(temp, 'original.pdf')
const output = path.join(temp, 'export.pdf')
fs.writeFileSync(source, annotatedPdf)
createRequire(import.meta.url)('../out/main/index.js')
app.setPath('userData', temp)
app.emit('open-file', { preventDefault: () => undefined }, source)

async function run() {
  await app.whenReady()
  const [win] = BrowserWindow.getAllWindows()
  const evaluate = (code) =>
    win.webContents.executeJavaScript(typeof code === 'function' ? '(' + code + ')()' : code)
  async function waitFor(code) {
    const check = typeof code === 'function' ? code : () => evaluate(code)
    const deadline = Date.now() + 15_000
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + code)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  await waitFor("document.querySelector('.visible .pdfViewer .page canvas')?.width > 0")
  await evaluate('document.querySelector(\'[aria-label="Add text"]\').click()')
  await waitFor("document.querySelector('.visible .annotationEditorLayer.freetextEditing')")
  await evaluate(() => {
    const layer = document.querySelector('.visible .annotationEditorLayer')
    const { left, top, height } = layer.getBoundingClientRect()
    const event = {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX: left + 100,
      clientY: top + height * 0.6
    }
    layer.dispatchEvent(new PointerEvent('pointerdown', event))
    layer.dispatchEvent(new PointerEvent('pointerup', event))
  })
  await waitFor('document.querySelector(".visible .freeTextEditor .internal")?.isContentEditable')
  await evaluate(() => {
    const editor = document.querySelector('.visible .freeTextEditor .internal')
    editor.focus()
    editor.innerText = 'Unsaved annotation'
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
  })

  const fileMenu = Menu.getApplicationMenu().items.find(({ label }) => label === 'File').submenu
  const saveCleanCopy = fileMenu.items.find(({ label }) => label === 'Export Without Annotations…')
  assert.ok(saveCleanCopy)
  const cleanOutput = path.join(temp, 'clean.pdf')
  await evaluate(() => {
    const postMessage = Worker.prototype.postMessage
    window.cleanExtractions = 0
    Worker.prototype.postMessage = function (message, ...args) {
      if (message.action === 'ExtractPages' && message.data.omitAnnotations)
        window.cleanExtractions++
      return postMessage.call(this, message, ...args)
    }
  })
  let cleanDestination
  let cleanAttempts = 0
  dialog.showSaveDialog = async (_window, options) => {
    assert.equal(options.defaultPath, 'original - without annotations.pdf')
    assert.equal(await evaluate('window.cleanExtractions'), 0)
    cleanAttempts++
    return cleanDestination ? { canceled: false, filePath: cleanDestination } : { canceled: true }
  }
  saveCleanCopy.click(undefined, win, win.webContents)
  await waitFor(() => cleanAttempts === 1)
  assert.equal(fs.existsSync(cleanOutput), false)

  cleanDestination = source
  saveCleanCopy.click(undefined, win, win.webContents)
  await waitFor('document.body.textContent.includes("An open PDF cannot be overwritten")')
  assert.deepEqual(fs.readFileSync(source), Buffer.from(annotatedPdf))

  cleanDestination = cleanOutput
  saveCleanCopy.click(undefined, win, win.webContents)
  await waitFor('document.body.textContent.includes("PDF copy saved without annotations.")')
  assert.equal(await evaluate('window.cleanExtractions'), 1)
  assert.deepEqual(fs.readFileSync(source), Buffer.from(annotatedPdf))
  const cleanTask = getDocument({ data: new Uint8Array(fs.readFileSync(cleanOutput)) })
  try {
    const pdf = await cleanTask.promise
    assert.equal(pdf.numPages, 1)
    const page = await pdf.getPage(1)
    const [link, field] = await page.getAnnotations()
    assert.deepEqual(
      (await page.getAnnotations()).map(({ subtype }) => subtype),
      ['Link', 'Widget']
    )
    assert.equal(link.url, 'https://example.com/')
    assert.equal(field.fieldValue, 'Saved form value')
    assert.deepEqual(
      (await page.getTextContent()).items.map(({ str }) => str),
      ['Page content']
    )
  } finally {
    await cleanTask.destroy()
  }

  const item = fileMenu.items.find(({ label }) => label === 'Export Flattened PDF…')
  assert.ok(item)
  const exportPdf = () => item.click(undefined, win, win.webContents)
  let destination
  let attempts = 0
  let renderedAnnotation = false
  let failPrint = false
  dialog.showSaveDialog = async (_window, options) => {
    assert.equal(options.defaultPath, 'original - flattened.pdf')
    assert.equal(await evaluate(() => document.querySelector('#pdf-print') !== null), false)
    attempts++
    return destination ? { canceled: false, filePath: destination } : { canceled: true }
  }
  const printToPDF = win.webContents.printToPDF.bind(win.webContents)
  win.webContents.printToPDF = async (options) => {
    if (failPrint) throw new Error('Simulated PDF export failure')
    renderedAnnotation = await evaluate(() => {
      const canvas = document.querySelector('#pdf-print canvas')
      const top = Math.floor(canvas.height / 2)
      const { data } = canvas
        .getContext('2d')
        .getImageData(0, top, canvas.width, canvas.height - top)
      return data.some((value, index) => index % 4 === 0 && value < 128)
    })
    return printToPDF(options)
  }

  exportPdf()
  await waitFor(() => attempts > 0)
  await waitFor('document.querySelector("#pdf-print") === null')
  assert.equal(attempts, 1)
  assert.equal(fs.existsSync(output), false)
  assert.equal(renderedAnnotation, false)

  destination = source
  exportPdf()
  await waitFor('document.body.textContent.includes("An open PDF cannot be overwritten")')
  assert.deepEqual(fs.readFileSync(source), Buffer.from(annotatedPdf))

  destination = output.slice(0, -4)
  failPrint = true
  exportPdf()
  await waitFor('document.body.textContent.includes("Simulated PDF export failure")')
  assert.equal(await evaluate('document.querySelector("#pdf-print")'), null)
  assert.equal(fs.existsSync(output), false)

  failPrint = false
  exportPdf()
  await waitFor('document.body.textContent.includes("Flattened PDF exported.")')
  assert.equal(attempts, 4)
  assert.equal(renderedAnnotation, true, 'The unsaved annotation is rendered before PDF generation')
  assert.deepEqual(fs.readFileSync(source), Buffer.from(annotatedPdf))
  assert.ok(
    await evaluate(
      () => document.querySelector('[aria-label="original.pdf"] > .bg-foreground') !== null
    )
  )

  const task = getDocument({ data: new Uint8Array(fs.readFileSync(output)) })
  try {
    const pdf = await task.promise
    assert.equal(pdf.numPages, 1)
    const page = await pdf.getPage(1)
    assert.deepEqual(await page.getAnnotations(), [])
    assert.deepEqual((await page.getTextContent()).items, [])
    assert.ok((await page.getOperatorList()).fnArray.includes(OPS.paintImageXObject))
  } finally {
    await task.destroy()
  }
  console.log(
    'The clean copy excludes annotations and preserves text, links and forms. Flattened export includes unsaved annotations.'
  )
}

function finish(code) {
  fs.rmSync(temp, { recursive: true, force: true })
  app.exit(code)
}

run().then(
  () => finish(0),
  (error) => {
    console.error(error)
    finish(1)
  }
)
