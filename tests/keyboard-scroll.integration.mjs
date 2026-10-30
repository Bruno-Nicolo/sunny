import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { blankPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-keyboard-scroll-'))
app.setPath('userData', temp)

ipcMain.handle('test:read', () => ({
  path: 'scroll.pdf',
  name: 'scroll.pdf',
  directoryPath: 'test',
  source: { kind: 'memory', data: new Uint8Array(blankPdf).buffer },
  mtimeMs: 1,
  size: blankPdf.length
}))
const preload = path.join(temp, 'preload.cjs')
fs.writeFileSync(
  preload,
  `
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('lepis', {
  releasePdfSource: async () => {},
  loadDrafts: async () => [], saveDraft: async () => {}, deleteDraft: async () => {},
  setTheme: () => {},
  loadSession: async () => ({ tabs: [{path:'scroll.pdf',page:1,scale:'3',scrollTop:0}], activePath:'scroll.pdf', highlightColor:'#FDE047', theme:'light' }),
  readPdf: () => ipcRenderer.invoke('test:read'),
  statPdf: async () => ({mtimeMs:1,size:1}), saveSession: async () => {}, closePdf: async () => {},
  openPdfDialog: async () => [], getPathForFile: () => '', confirmWindowClose: () => {},
  onOpenRequested: () => () => {}, onCommand: () => () => {}
})`
)
let win
const evaluate = (code) => win.webContents.executeJavaScript(code)
app
  .whenReady()
  .then(async () => {
    win = new BrowserWindow({
      show: false,
      width: 1180,
      height: 780,
      webPreferences: {
        backgroundThrottling: false,
        preload,
        sandbox: true,
        contextIsolation: true
      }
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await enableTestFocus(win)
    const deadline = Date.now() + 15000
    while (
      !(await evaluate(`document.querySelector('.visible .pdfViewer .page canvas')?.width > 0`))
    ) {
      if (Date.now() > deadline) throw new Error('PDF did not render')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    for (const [key, axis, direction] of [
      ['ArrowDown', 'scrollTop', 1],
      ['ArrowUp', 'scrollTop', -1],
      ['ArrowRight', 'scrollLeft', 1],
      ['ArrowLeft', 'scrollLeft', -1]
    ]) {
      const result = await evaluate(`(async () => {
        const container = document.querySelector('.visible .pdf-viewer-container')
        const focus = document.querySelector('[aria-label="Toggle PDF sidebar"]')
        focus.focus()
        container.scrollTo({top: 600, left: 600, behavior: 'instant'})
        const start = container.${axis}
        const samples = []
        for (let i = 0; i < 12; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', {
            key: '${key}', repeat: i > 0, bubbles: true, cancelable: true
          }))
          await new Promise(resolve => setTimeout(resolve, 33))
          samples.push(container.${axis})
        }
        await new Promise(resolve => setTimeout(resolve, 350))
        return {distance: (container.${axis} - start) * ${direction},
          samples, focused: document.activeElement === focus}
      })()`)
      console.log(key, '12 repeated events, expected 480px; actual:', result.distance)
      assert.ok(
        Math.abs(result.distance - 480) <= 2,
        'Repeated arrows must preserve accumulated distance'
      )
      assert.equal(result.focused, true, 'Scrolling must preserve keyboard focus')
      assert.ok(
        result.samples.slice(1).every((value, i) => (value - result.samples[i]) * direction > 0),
        'Scroll must keep progressing between repeated events'
      )
    }
    for (const interruption of ['wheel', 'pointerdown']) {
      const result = await evaluate(`(async () => {
        const container = document.querySelector('.visible .pdf-viewer-container')
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown', bubbles: true, cancelable: true
        }))
        await new Promise(resolve => setTimeout(resolve, 33))
        container.dispatchEvent(new Event('${interruption}'))
        const start = container.scrollTop
        await new Promise(resolve => setTimeout(resolve, 200))
        return container.scrollTop - start
      })()`)
      assert.equal(result, 0, `${interruption} must cancel pending keyboard scrolling`)
    }
    console.log(
      'PASS: four directions accumulate smoothly, preserve focus and yield to pointer input'
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
