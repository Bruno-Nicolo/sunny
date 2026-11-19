import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import electron from 'electron'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { textPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, dialog, Menu } = electron
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sunny-flattened-'))
const source = path.join(temp, 'original.pdf')
const output = path.join(temp, 'export.pdf')
fs.writeFileSync(source, textPdf)
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
  const item = fileMenu.items.find(({ label }) => label === 'Export Flattened PDF…')
  assert.ok(item)
  const exportPdf = () => item.click(undefined, win, win.webContents)
  let destination
  let attempts = 0
  let renderedAnnotation = false
  dialog.showSaveDialog = async (_window, options) => {
    assert.equal(options.defaultPath, 'original - flattened.pdf')
    assert.equal(await evaluate(() => document.querySelector('#pdf-print') !== null), false)
    attempts++
    return destination ? { canceled: false, filePath: destination } : { canceled: true }
  }
  const printToPDF = win.webContents.printToPDF.bind(win.webContents)
  win.webContents.printToPDF = async (options) => {
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
  assert.deepEqual(fs.readFileSync(source), Buffer.from(textPdf))

  destination = output.slice(0, -4)
  exportPdf()
  await waitFor('document.body.textContent.includes("Flattened PDF exported.")')
  assert.equal(attempts, 3)
  assert.equal(renderedAnnotation, true, 'The unsaved annotation is rendered before PDF generation')
  assert.deepEqual(fs.readFileSync(source), Buffer.from(textPdf))
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
    'Flattened PDF export includes unsaved annotations, handles cancellation and protects the original.'
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
