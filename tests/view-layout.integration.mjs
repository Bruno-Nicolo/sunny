import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPdf } from './fixtures/pdf.mjs'

const blankPdf = createPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
  ...Array(3).fill('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>')
])

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-view-layout-'))
app.setPath('userData', temp)

ipcMain.handle('test:read', (_, name) => ({
  path: name,
  name,
  directoryName: 'test',
  data: new Uint8Array(blankPdf).buffer,
  mtimeMs: 1,
  size: blankPdf.length
}))
const preload = path.join(temp, 'preload.cjs')
fs.writeFileSync(
  preload,
  `
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('lepis', {
  loadDrafts: async () => [], saveDraft: async () => {}, deleteDraft: async () => {},
  setTheme: () => {},
  loadSession: async () => ({ tabs: ['other.pdf','layout.pdf'].map(path => ({path,page:1,scale:'page-fit',scrollTop:0})), activePath:'layout.pdf', highlightColor:'#FDE047', theme:'light' }),
  readPdf: path => ipcRenderer.invoke('test:read',path),
  statPdf: async () => ({mtimeMs:1,size:1}), saveSession: async () => {}, closePdf: async () => {},
  openPdfDialog: async () => [], getPathForFile: () => '', confirmWindowClose: () => {},
  onOpenRequested: () => () => {}, onCommand: () => () => {}
})`
)
let win
const evaluate = (code) => win.webContents.executeJavaScript(code)
async function waitFor(code) {
  const deadline = Date.now() + 15000
  while (!(await evaluate(code))) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
const click = (label) => evaluate(`document.querySelector('[aria-label="${label}"]').click()`)
const orientation = () =>
  evaluate(`(() => {
    const page = document.querySelector('.visible .page').getBoundingClientRect()
    return page.width > page.height ? 'landscape' : 'portrait'
  })()`)
app
  .whenReady()
  .then(async () => {
    win = new BrowserWindow({
      show: false,
      width: 1180,
      height: 780,
      webPreferences: { preload, sandbox: true, contextIsolation: true }
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await waitFor(`document.querySelector('.visible .pdfViewer .page canvas')?.width > 0`)
    assert.equal(await orientation(), 'portrait')
    await click('Rotate clockwise')
    await waitFor(
      `document.querySelector('.visible .page').getBoundingClientRect().width > document.querySelector('.visible .page').getBoundingClientRect().height`
    )
    const landscape = await evaluate(`(() => {
      const page = document.querySelector('.visible .page').getBoundingClientRect()
      return page.width > page.height
    })()`)
    assert.ok(landscape, 'Rotation must change page geometry')
    for (let i = 0; i < 3; i++) await click('Rotate clockwise')
    assert.equal(
      await orientation(),
      'portrait',
      'Four rotations must return to the original orientation'
    )

    await click('Two-page view')
    await waitFor(`document.querySelector('.visible .spread')?.children.length === 2`)
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Two-page view"]').getAttribute('aria-pressed')`
      ),
      'true'
    )
    const layout = await evaluate(`(() => {
      const spreads = document.querySelectorAll('.visible .spread')
      const [first, second] = [...spreads[0].children].map(page => page.getBoundingClientRect())
      const container = document.querySelector('.visible .pdf-viewer-container')
      return {
        counts: [...spreads].map(spread => spread.children.length),
        aligned: Math.abs(first.top - second.top) < 1,
        separated: second.left > first.right,
        fits: container.scrollWidth <= container.clientWidth + 1
      }
    })()`)
    assert.deepEqual(layout.counts, [2, 1], 'An odd final page must remain visible')
    assert.ok(layout.aligned && layout.separated, 'Pages must sit side by side with a gap')
    assert.ok(layout.fits, 'Fit page must fit both pages in the viewer width')
    await click('Rotate clockwise')
    assert.equal(await orientation(), 'landscape', 'Rotation must also work in two-page view')

    await evaluate(`document.querySelector('[aria-label="other.pdf"]').click()`)
    await waitFor(
      `document.querySelector('[aria-label="Two-page view"]').getAttribute('aria-pressed') === 'false'`
    )
    assert.equal(await orientation(), 'portrait', 'Other tabs must keep their own rotation')
    await evaluate(`document.querySelector('[aria-label="layout.pdf"]').click()`)
    await waitFor(
      `document.querySelector('[aria-label="Two-page view"]').getAttribute('aria-pressed') === 'true'`
    )
    assert.equal(await orientation(), 'landscape', 'Switching tabs must preserve rotation')
    await click('Two-page view')
    await waitFor(`document.querySelectorAll('.visible .spread').length === 0`)
    assert.equal(
      await evaluate(`document.querySelectorAll('.visible .pdfViewer > .page').length`),
      3
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Two-page view"]').getAttribute('aria-pressed')`
      ),
      'false'
    )
    console.log(
      'PASS: rotation, paired pages, odd final page, fit scale, toggling, and tab isolation'
    )
  })
  .then(() => finish(0))
  .catch((error) => {
    console.error(error)
    finish(1)
  })
function finish(code) {
  win?.destroy()
  fs.rmSync(temp, { recursive: true, force: true })
  app.exit(code)
}
