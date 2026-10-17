import { enableTestFocus } from './fixtures/focus.mjs'
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
  loadSession: async () => ({ tabs: ['other.pdf','layout.pdf'].map(path => ({path,page:1,scale:'page-fit',scrollTop:0})), activePath:'layout.pdf', highlightColor:'#FDE047', theme:'light' }),
  readPdf: path => ipcRenderer.invoke('test:read',path),
  statPdf: async () => ({mtimeMs:1,size:1}), saveSession: async () => {}, closePdf: async () => {},
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
const evaluate = (code) => win.webContents.executeJavaScript(code)
async function waitFor(code, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (!(await evaluate(code))) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
const command = (id) => win.webContents.send(`menu:${id}`)
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
      webPreferences: {
        backgroundThrottling: false,
        preload,
        sandbox: true,
        contextIsolation: true
      }
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await enableTestFocus(win)
    await waitFor(`document.querySelector('.visible .pdfViewer .page canvas')?.width > 0`)
    for (const selector of [
      '[aria-label="Toggle PDF sidebar"]',
      '[aria-label="layout.pdf"]',
      '.visible .pdf-viewer-container'
    ]) {
      await evaluate(`document.querySelector('${selector}').focus()`)
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' })
      await waitFor(`document.querySelector('.visible .pdf-viewer-container').scrollTop > 0`, 1500)
      await new Promise((resolve) => setTimeout(resolve, 200))
      assert.equal(
        await evaluate(`document.activeElement === document.querySelector('${selector}')`),
        true,
        'Scrolling must preserve keyboard focus'
      )
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' })
      await waitFor(
        `document.querySelector('.visible .pdf-viewer-container').scrollTop === 0`,
        1500
      )
    }
    assert.equal(
      await evaluate(`document.querySelector('.invisible .pdf-viewer-container')?.scrollTop ?? 0`),
      0,
      'Scrolling must only affect the active PDF'
    )
    for (const key of ['ArrowUp', 'ArrowDown']) {
      assert.equal(
        await evaluate(`(() => {
          const input = document.querySelector('[aria-label="Current page"]')
          input.focus()
          const event = new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true })
          input.dispatchEvent(event)
          return event.defaultPrevented
        })()`),
        false,
        'Arrow keys must retain their normal behavior in text inputs'
      )
    }
    assert.equal(await orientation(), 'portrait')
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Rotate clockwise"], [aria-label="Two-page view"]') === null`
      ),
      true,
      'View commands must not occupy the document toolbar'
    )
    await evaluate(`(() => {
      const input = document.querySelector('[aria-label="Current page"]')
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }))
    })()`)
    assert.equal(await orientation(), 'portrait', 'Typing r in an input must not rotate the PDF')
    await evaluate(`document.activeElement.blur()`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'R' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'R' })
    await waitFor(
      `document.querySelector('.visible .page').getBoundingClientRect().width > document.querySelector('.visible .page').getBoundingClientRect().height`
    )
    const landscape = await evaluate(`(() => {
      const page = document.querySelector('.visible .page').getBoundingClientRect()
      return page.width > page.height
    })()`)
    assert.ok(landscape, 'Rotation must change page geometry')
    for (let i = 0; i < 3; i++) {
      command('rotate-clockwise')
      await waitFor(
        `document.querySelector('.visible .page').getBoundingClientRect().width ${i === 1 ? '>' : '<'} document.querySelector('.visible .page').getBoundingClientRect().height`
      )
    }
    assert.equal(
      await orientation(),
      'portrait',
      'Four rotations must return to the original orientation'
    )

    command('toggle-two-page-view')
    await waitFor(`document.querySelector('.visible .spread')?.children.length === 2`)

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
    command('rotate-clockwise')
    await waitFor(
      `document.querySelector('.visible .page').getBoundingClientRect().width > document.querySelector('.visible .page').getBoundingClientRect().height`
    )
    assert.equal(await orientation(), 'landscape', 'Rotation must also work in two-page view')

    await evaluate(`document.querySelector('[aria-label="other.pdf"]').click()`)
    await waitFor(
      `document.querySelector('.visible .page canvas')?.width > 0 && document.querySelectorAll('.visible .spread').length === 0`
    )
    assert.equal(await orientation(), 'portrait', 'Other tabs must keep their own rotation')
    await evaluate(`document.querySelector('[aria-label="layout.pdf"]').click()`)
    await waitFor(`document.querySelector('.visible .spread')?.children.length === 2`)
    assert.equal(await orientation(), 'landscape', 'Switching tabs must preserve rotation')
    command('toggle-two-page-view')
    await waitFor(`document.querySelectorAll('.visible .spread').length === 0`)
    assert.equal(
      await evaluate(`document.querySelectorAll('.visible .pdfViewer > .page').length`),
      3
    )

    console.log(
      'PASS: vertical scrolling without viewer focus, input guards, rotation, paired pages, fit scale, and tab isolation'
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
