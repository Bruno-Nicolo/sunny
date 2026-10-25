import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-print-'))
app.setPath('userData', temp)
const content = '1 0 0 rg 0 0 612 792 re f'
const pdf = createPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 5 0 R >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << >> >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
])
ipcMain.handle('test:read', (_, name) => ({
  path: name,
  name,
  directoryName: 'test',
  source: { kind: 'memory', data: new Uint8Array(pdf).buffer },
  mtimeMs: 1,
  size: pdf.length
}))
const preload = path.join(temp, 'preload.cjs')
fs.writeFileSync(
  preload,
  `
const { contextBridge, ipcRenderer } = require('electron')
window.addEventListener('message', event => {
  if (event.source !== window || event.data !== 'test:print') return
  ipcRenderer.invoke('test:print').then(
    () => window.dispatchEvent(new Event('afterprint')),
    error => {
      console.error(error)
      window.dispatchEvent(new Event('afterprint'))
    }
  )
})
contextBridge.exposeInMainWorld('lepis', {
  releasePdfSource: async () => {},
  loadDrafts: async () => [], saveDraft: async () => {}, deleteDraft: async () => {},
  setTheme: () => {},
  loadSession: async () => ({ tabs: ['other.pdf','print.pdf'].map(path => ({path,page:1,scale:'page-fit',scrollTop:0})), activePath:'print.pdf', highlightColor:'#FDE047', theme:'light' }),
  readPdf: path => ipcRenderer.invoke('test:read',path),
  statPdf: async () => ({mtimeMs:1,size:${pdf.length}}), saveSession: async () => {}, closePdf: async () => {},
  openPdfDialog: async () => [], getPathForFile: () => '', confirmWindowClose: () => {},
  onOpenRequested: () => () => {},
  onCommand: (command, callback) => {
    const channel = 'menu:' + command
    const listener = () => callback()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
})`
)
let win
let jobs = 0
let verified = false
const printedJob = Promise.withResolvers()
const evaluate = (code) => win.webContents.executeJavaScript(code)
async function waitFor(code) {
  const deadline = Date.now() + 15000
  while (!(await evaluate(code))) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
ipcMain.handle('test:print', () => verifyPrint().finally(() => printedJob.resolve()))
async function verifyPrint() {
  jobs++
  assert.equal(await evaluate(`document.querySelectorAll('#pdf-print canvas').length`), 2)
  assert.deepEqual(
    await evaluate(`(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    context.drawImage(document.querySelector('#pdf-print canvas'), 0, 0, 1, 1)
    return [...context.getImageData(0, 0, 1, 1).data]
  })()`),
    [255, 0, 0, 255],
    'Print the PDF page content'
  )
  // A repeated shortcut must not open a second print job while this one is pending.
  win.webContents.send('menu:print')
  const output = await win.webContents.printToPDF({
    preferCSSPageSize: true,
    printBackground: true
  })
  const task = getDocument({ data: new Uint8Array(output) })
  try {
    const printed = await task.promise
    assert.equal(printed.numPages, 2, 'Print only the active PDF, with no application UI pages')
    for (const [number, width, height] of [
      [1, 612, 792],
      [2, 792, 612]
    ]) {
      const page = await printed.getPage(number)
      const viewport = page.getViewport({ scale: 1 })
      assert.ok(
        Math.abs(viewport.width - width) < 1,
        `Page ${number}: width ${viewport.width}, expected ${width}`
      )
      assert.ok(
        Math.abs(viewport.height - height) < 1,
        `Page ${number}: height ${viewport.height}, expected ${height}`
      )
    }
    verified = true
  } finally {
    await task.destroy()
  }
}
app
  .whenReady()
  .then(async () => {
    win = new BrowserWindow({
      show: false,
      webPreferences: { preload, backgroundThrottling: false }
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await waitFor(`document.querySelector('.visible .pdfViewer .page canvas')?.width > 0`)
    await evaluate(`void (window.print = () => {
      window.dispatchEvent(new Event('beforeprint'))
      window.postMessage('test:print', '*')
    })`)
    win.webContents.send('menu:print')
    await printedJob.promise
    await waitFor(`document.querySelector('#pdf-print') === null`)
    assert.equal(jobs, 1)
    assert.equal(verified, true, 'Printed PDF must pass all content checks')
    await evaluate(`void (window.print = () => { throw new Error('Test print failure') })`)
    win.webContents.send('menu:print')
    await waitFor(`document.body.textContent.includes('Test print failure')`)
    assert.equal(await evaluate(`document.querySelector('#pdf-print') === null`), true)
    assert.equal(jobs, 1)
    console.log(
      'PDF printing preserves page count and sizes, prevents duplicate jobs and cleans up failures.'
    )
  })
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
