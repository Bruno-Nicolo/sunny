import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { blankPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-zoom-'))
app.setPath('userData', temp)

ipcMain.handle('test:read', () => ({
  path: 'zoom.pdf',
  name: 'zoom.pdf',
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
  loadSession: async () => ({ tabs: [{path:'zoom.pdf',page:1,scale:'1',scrollTop:0}], activePath:'zoom.pdf', highlightColor:'#FDE047', theme:'light' }),
  readPdf: () => ipcRenderer.invoke('test:read'),
  statPdf: async () => ({mtimeMs:1,size:1}), saveSession: async () => {}, closePdf: async () => {},
  openPdfDialog: async () => [], getPathForFile: () => '', confirmWindowClose: () => {},
  onOpenRequested: () => () => {}, onCommand: () => () => {}
})`
)
let win
const evaluate = (code) => win.webContents.executeJavaScript(code)
const scale = () =>
  evaluate(
    `Number(document.querySelector('.visible .pdfViewer').style.getPropertyValue('--scale-factor'))`
  )
const wheel = (deltaY, ctrlKey) =>
  evaluate(`(() => {
  const container = document.querySelector('.visible .pdf-viewer-container')
  const bounds = container.getBoundingClientRect()
  const event = new WheelEvent('wheel', {
    deltaY: ${deltaY}, ctrlKey: ${ctrlKey}, bubbles: true, cancelable: true,
    clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2
  })
  container.dispatchEvent(event)
  return event.defaultPrevented
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
    const deadline = Date.now() + 15000
    while (
      !(await evaluate(`document.querySelector('.visible .pdfViewer .page canvas')?.width > 0`))
    ) {
      if (Date.now() > deadline) throw new Error('PDF did not render')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const before = await scale()
    await wheel(-50, true)
    assert.ok((await scale()) > before, 'Trackpad pinch must increase PDF scale')
    assert.equal(await wheel(50, true), true, 'Pinch must suppress browser zoom')
    assert.ok(Math.abs((await scale()) - before) < 0.02, 'Reverse pinch must restore PDF scale')
    const normal = await scale()
    assert.equal(await wheel(-50, false), false, 'Two-finger scrolling must remain available')
    assert.equal(await scale(), normal, 'Ordinary scrolling must not change PDF scale')
    assert.equal(win.webContents.getZoomFactor(), 1, 'App chrome must retain its scale')
    console.log(
      'PASS: pinch zooms the PDF in both directions; ordinary scrolling and app scale are preserved'
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
