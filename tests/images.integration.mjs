import electron from 'electron'
const { app, BrowserWindow, ipcMain } = electron
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-images-'))
app.setPath('userData', temp)
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',
  '<< /Length 0 >>\nstream\n\nendstream'
]
let pdf = '%PDF-1.7\n'
const offsets = [0]
for (const [index, object] of objects.entries()) {
  offsets.push(pdf.length)
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
}
const xref = pdf.length
pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((x) => `${String(x).padStart(10, '0')} 00000 n \n`)
  .join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
const saved = new Map()
ipcMain.handle('test:read', (_, name) => ({
  path: name,
  name,
  directoryName: 'test',
  data: new Uint8Array(saved.get(name) ?? Buffer.from(pdf)),
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
const count = (n) => `document.querySelectorAll('.visible .stampEditor canvas').length === ${n}`
const imageSetup = `const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0,0,80,40); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); const file = new File([blob], 'test.png', {type:'image/png'}); const transfer = new DataTransfer(); transfer.items.add(file);`
app
  .whenReady()
  .then(async () => {
    win = new BrowserWindow({
      show: false,
      width: 1180,
      height: 780,
      webPreferences: { preload, sandbox: true, contextIsolation: true }
    })
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') process.stderr.write(details.message + '\n')
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await waitFor(
      `document.querySelector('[aria-label="Add image"]')?.disabled === false && !document.body.textContent.includes('Opening document')`
    )
    await evaluate(
      `(async () => { ${imageSetup} const input = document.querySelector('[aria-label="Choose images"]'); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`
    )
    await waitFor(count(1))
    console.log('PASS: image upload creates editable image')
    await evaluate(`(() => {
      const editor = document.querySelector('.visible .stampEditor');
      editor.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, pointerId:1}));
      window.dispatchEvent(new PointerEvent('pointerup', {button:0, pointerId:1}));
    })()`)
    await waitFor(`document.querySelectorAll('.visible .stampEditor .resizer').length === 8`)
    await waitFor(`document.querySelector('.visible .stampEditor .editToolbar') !== null`)
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.visible .stampEditor .editToolbar')).display`
      ),
      'none',
      'The image toolbar must be hidden, including its background'
    )
    const oldLeft = await evaluate(`document.querySelector('.visible .stampEditor').style.left`)
    await evaluate(`(() => {
      const editor = document.querySelector('.visible .stampEditor');
      editor.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, pointerId:1, clientX:100, clientY:100}));
      window.dispatchEvent(new PointerEvent('pointermove', {pointerId:1, clientX:120, clientY:110}));
      window.dispatchEvent(new PointerEvent('pointerup', {button:0, pointerId:1}));
    })()`)
    assert.notEqual(
      await evaluate(`document.querySelector('.visible .stampEditor').style.left`),
      oldLeft
    )
    const oldWidth = await evaluate(`document.querySelector('.visible .stampEditor').style.width`)
    await evaluate(`(() => {
      const resizer = document.querySelector('.visible .stampEditor .bottomRight');
      resizer.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, pointerId:1, screenX:100, screenY:100}));
      window.dispatchEvent(new PointerEvent('pointermove', {pointerId:1, screenX:140, screenY:120}));
      window.dispatchEvent(new PointerEvent('pointerup', {button:0, pointerId:1}));
    })()`)
    assert.notEqual(
      await evaluate(`document.querySelector('.visible .stampEditor').style.width`),
      oldWidth
    )
    console.log('PASS: inserted image can be moved and resized')
    await evaluate(
      `(async () => { ${imageSetup} document.querySelector('.visible .pdf-viewer-container').dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer,bubbles:true,cancelable:true})); })()`
    )
    await waitFor(count(2))
    assert.equal(await evaluate(`document.querySelectorAll('.invisible .stampEditor').length`), 0)
    console.log('PASS: clipboard image goes only to active tab')
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(count(1))
    await evaluate(`window.testCommands.run('redo')`)
    await waitFor(count(2))
    console.log('PASS: image insertion supports undo and redo')
    await evaluate(
      `(async () => { ${imageSetup} document.querySelector('.visible .pdf-viewer-container').dispatchEvent(new DragEvent('drop', {dataTransfer:transfer,bubbles:true,cancelable:true})); })()`
    )
    await waitFor(count(3))
    console.log('PASS: image drop inserts once')
    await evaluate(
      `(async () => { ${imageSetup} document.querySelector('[aria-label="Current page"]').dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer,bubbles:true,cancelable:true})); })()`
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    await waitFor(count(3))
    console.log('PASS: pasting in an input does not add an image')
    await evaluate(
      `const transfer = new DataTransfer(); transfer.items.add(new File(['invalid'], 'broken.png', {type:'image/png'})); const input = document.querySelector('[aria-label="Choose images"]'); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}))`
    )
    await waitFor(`document.body.textContent.includes('The image could not be opened.')`)
    assert.equal(await evaluate(count(3)), true)
    console.log('PASS: invalid images show an error without adding an annotation')
    await evaluate(`window.testCommands.run('save')`)
    await waitFor(`document.body.textContent.includes('Saved')`)
    assert.equal(saved.has('first.pdf'), false)
    assert.match(saved.get('second.pdf').toString('latin1'), /\/Subtype\s*\/Image/)
    assert.equal(
      (
        saved
          .get('second.pdf')
          .toString('latin1')
          .match(/\/Subtype\s*\/Stamp/g) ?? []
      ).length,
      3
    )
    console.log('PASS: save embeds three image annotations in PDF')
    await win.reload()
    await waitFor(
      `document.querySelector('[aria-label="Add image"]')?.disabled === false && !document.body.textContent.includes('Opening document')`
    )
    // Switch to editing through another insertion to check existing stamps are restored.
    await evaluate(
      `(async () => { ${imageSetup} const input = document.querySelector('[aria-label="Choose images"]'); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`
    )
    await waitFor(count(4))
    console.log('PASS: saved images remain editable after reopening')
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
