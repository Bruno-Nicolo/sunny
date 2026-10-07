import electron from 'electron'
import { blankPdf } from './fixtures/pdf.mjs'
const { app, BrowserWindow, ipcMain } = electron
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-highlight-'))
app.setPath('userData', temp)
const pdf = Buffer.from(blankPdf)
const saved = new Map()
ipcMain.handle('test:read', (_, name) => ({
  path: name,
  name,
  directoryName: 'test',
  data: new Uint8Array(saved.get(name) ?? Buffer.from(pdf)).buffer,
  mtimeMs: 1,
  size: pdf.length
}))
ipcMain.handle('test:save', (_, payload) => {
  saved.set(payload.filePath, Buffer.from(payload.data))
  return { mtimeMs: 1, size: payload.data.length }
})
const preload = path.join(temp, 'preload.cjs')
fs.writeFileSync(
  preload,
  `const { contextBridge, ipcRenderer } = require('electron')
const handlers = new Map()
contextBridge.exposeInMainWorld('lepis', {
  setTheme: () => {},
  loadSession: async () => ({ tabs: [{path:'first.pdf',page:1,scale:'page-fit',scrollTop:0},{path:'second.pdf',page:1,scale:'page-fit',scrollTop:0}], activePath:'second.pdf', highlightColor:'#FDE047', theme:'light' }),
  readPdf: path => ipcRenderer.invoke('test:read', path),
  savePdf: payload => ipcRenderer.invoke('test:save', payload),
  statPdf: async () => ({mtimeMs:1,size:1}), saveSession: async () => {},
  closePdf: async () => {}, openPdfDialog: async () => [], getPathForFile: () => '', confirmWindowClose: () => {},
  onOpenRequested: () => () => {}, onCommand: (name, cb) => { handlers.set(name,cb); return () => handlers.delete(name) }
})
contextBridge.exposeInMainWorld('testCommands', {run: name => handlers.get(name)?.()})`
)
let win
const evaluate = (code) => win.webContents.executeJavaScript(code)
async function waitFor(code) {
  const start = Date.now()
  while (!(await evaluate(code))) {
    if (Date.now() - start > 15000) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
app
  .whenReady()
  .then(async () => {
    win = new BrowserWindow({
      show: true,
      width: 1180,
      height: 780,
      webPreferences: { preload, sandbox: true, contextIsolation: true }
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await waitFor(
      `document.querySelector('[aria-label="Highlight text"]')?.disabled === false && !document.body.textContent.includes('Opening document')`
    )
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    await waitFor(
      `document.querySelector('.visible .annotationEditorLayer.highlightEditing') !== null`
    )
    const { x, y } = await evaluate(
      `(() => { const rect = document.querySelector('.visible .textLayer').getBoundingClientRect(); return {x: Math.round(rect.left+100),y: Math.round(rect.top+100)} })()`
    )
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x, y, clickCount: 1 })
    for (let i = 1; i <= 10; i++)
      win.webContents.sendInputEvent({ type: 'mouseMove', x: x + i * 8, y })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: x + 80, y, clickCount: 1 })
    await waitFor(
      `document.querySelector('.visible .highlightEditor .editToolbar:not(.hidden) .deleteButton') !== null`
    )
    const geometry = await evaluate(`(() => {
    const toolbar = document.querySelector('.visible .highlightEditor .editToolbar:not(.hidden)');
    const button = toolbar.querySelector('.deleteButton');
    const icon = getComputedStyle(button,'::before');
    const rect = element => {const {x,y,width,height} = element.getBoundingClientRect(); return {x,y,width,height}};
    return {toolbar:rect(toolbar),button:rect(button),icon:{display:icon.display,height:icon.height,top:icon.top,position:icon.position}};
  })()`)
    // Measure the pseudo-element itself: the button can fit while its icon overflows.
    win.webContents.debugger.attach('1.3')
    const { root: dom } = await win.webContents.debugger.sendCommand('DOM.getDocument', {
      depth: -1,
      pierce: true
    })
    const findIcon = (node) => {
      if (node.attributes?.includes('basic deleteButton'))
        return node.pseudoElements?.find((pseudo) => pseudo.pseudoType === 'before')
      for (const child of node.children ?? []) {
        const found = findIcon(child)
        if (found) return found
      }
    }
    const iconNode = findIcon(dom)
    const { model } = await win.webContents.debugger.sendCommand('DOM.getBoxModel', {
      backendNodeId: iconNode.backendNodeId
    })
    win.webContents.debugger.detach()
    assert.ok(
      Math.min(model.border[1], model.border[3], model.border[5], model.border[7]) >=
        geometry.toolbar.y &&
        Math.max(model.border[1], model.border[3], model.border[5], model.border[7]) <=
          geometry.toolbar.y + geometry.toolbar.height,
      'Delete icon must be drawn inside the highlight toolbar'
    )
    assert.ok(
      geometry.button.y >= geometry.toolbar.y &&
        geometry.button.y + geometry.button.height <= geometry.toolbar.y + geometry.toolbar.height,
      'Delete button must remain inside highlight toolbar'
    )
    assert.ok(
      parseFloat(geometry.icon.height) <= geometry.button.height,
      'Delete icon must fit inside its button'
    )
    console.log('PASS: highlight delete button and icon remain inside toolbar')
    await evaluate(`document.querySelector('.visible .highlightEditor .deleteButton').click()`)
    await waitFor(`document.querySelector('.visible .highlightEditor') === null`)
    console.log('PASS: toolbar delete button removes the highlight')
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
