import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import { createPdf } from './fixtures/pdf.mjs'
const { app, BrowserWindow, ipcMain } = electron
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-annotation-loading-'))
app.setPath('userData', temp)
const existingCount = Math.max(3, Number(process.env.LEPIS_ANNOTATION_COUNT ?? 3))
const originalText = 'BT /F1 24 Tf 72 700 Td (First highlight) Tj 0 -40 Td (Second highlight) Tj ET'
const pdf = Buffer.from(
  createPdf([
    `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${existingCount + 6} 0 R] /DR << /Font << /Helv 5 0 R >> >> >> >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [${Array.from({ length: existingCount }, (_, index) => `${6 + index} 0 R`).join(' ')} ${existingCount + 6} 0 R] >>`,
    `<< /Length ${originalText.length} >>\nstream\n${originalText}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...Array.from({ length: existingCount }, (_, index) =>
      index === 1 || index === 2
        ? `<< /Type /Annot /Subtype /Highlight /Rect [300 400 350 450] /QuadPoints [300 450 350 450 300 400 350 400] /C [${index === 1 ? '1 0 0' : '0 0 1'}] /CA 0.4 /F 4 >>`
        : '<< /Type /Annot /Subtype /Highlight /Rect [72 695 230 723] /QuadPoints [72 723 230 723 72 695 230 695] /C [1 1 0] /F 4 >>'
    ),
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (test-form) /V (initial) /DA (/Helv 12 Tf 0 g) /Rect [72 400 250 425] /F 4 /P 3 0 R >>'
  ])
)
const saved = new Map()
let holdSave = false
let releaseSave = null
ipcMain.handle('test:read', (_, name) => ({
  path: name,
  name,
  directoryName: 'test',
  source: { kind: 'memory', data: new Uint8Array(saved.get(name) ?? Buffer.from(pdf)).buffer },
  mtimeMs: 1,
  size: pdf.length
}))
ipcMain.handle('test:save', async (_, payload) => {
  if (holdSave)
    await new Promise((resolve) => {
      releaseSave = resolve
    })
  saved.set(payload.filePath, Buffer.from(payload.data))
  return { mtimeMs: 1, size: payload.data.length }
})
const preload = path.join(temp, 'preload.cjs')
fs.writeFileSync(
  preload,
  `const { contextBridge, ipcRenderer } = require('electron')
const handlers = new Map()
contextBridge.exposeInMainWorld('lepis', {
  releasePdfSource: async () => {},
  loadDrafts: async () => [], saveDraft: async () => {}, deleteDraft: async () => {},
  setTheme: () => {},
  loadSession: async () => ({ tabs: [{path:'second.pdf',page:1,scale:'page-fit',scrollTop:0}], activePath:'second.pdf', highlightColor:'#FDE047', theme:'light' }),
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
  const check = typeof code === 'function' ? code : () => evaluate(code)
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > 15000) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
async function chooseColor(current, next) {
  await evaluate(`document.querySelector('[aria-label="Highlight color: ${current}"]').click()`)
  await waitFor(`document.querySelector('[aria-label="${next}"]') !== null`)
  await evaluate(`document.querySelector('[aria-label="${next}"]').click()`)
  await waitFor(
    `document.querySelector('[aria-label="Highlight color: ${next}"]') !== null && !document.querySelector('[aria-label="${next}"]')`
  )
}

async function highlightText(text, count) {
  await evaluate(`(() => {
    const span = [...document.querySelectorAll('.visible .textLayer span')].find(s => s.textContent === ${JSON.stringify(text)});
    const range = document.createRange(); range.selectNodeContents(span);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  })()`)
  await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === ${count}`)
}

function pressKey(keyCode) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
}

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
    await waitFor(
      `document.querySelector('[aria-label="Highlight text"]')?.disabled === false && !document.body.textContent.includes('Opening document')`
    )
    await waitFor(`document.querySelector('.visible .textLayer span') !== null`)
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`
      ),
      false
    )
    await waitFor(
      `document.querySelectorAll('.visible .highlightEditor').length === ${existingCount}`
    )
    const textBounds = await evaluate(
      `(() => {const rect=[...document.querySelectorAll('.visible .textLayer span')].find(span=>span.textContent==='First highlight').getBoundingClientRect();return {x:Math.floor(rect.x),y:Math.floor(rect.y),width:Math.ceil(rect.width),height:Math.ceil(rect.height)}})()`
    )
    const pixels = (await win.webContents.capturePage(textBounds)).toBitmap()
    let darkPixels = 0
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] < 60 && pixels[i + 1] < 60 && pixels[i + 2] < 60) darkPixels++
    assert.ok(darkPixels > 20, 'Highlight blending must preserve the black text underneath')
    const overlapBounds = await evaluate(
      `(() => {const rect=document.querySelector('.visible .canvasWrapper canvas').getBoundingClientRect();return {x:Math.round(rect.x+325*rect.width/612),y:Math.round(rect.y+(792-425)*rect.height/792),width:1,height:1}})()`
    )
    const overlap = (await win.webContents.capturePage(overlapBounds)).toBitmap()
    await evaluate(`(() => {
      const swatch = document.createElement('div'); swatch.id = 'blend-reference';
      swatch.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;background:white;isolation:isolate;z-index:99999';
      for (const color of ['rgba(255,0,0,0.4)', 'rgba(0,0,255,0.4)']) {
        const layer = document.createElement('div');
        layer.style.cssText = 'position:absolute;inset:0;mix-blend-mode:multiply;background:' + color;
        swatch.append(layer);
      }
      document.body.append(swatch);
    })()`)
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    const reference = (
      await win.webContents.capturePage({ x: 5, y: 5, width: 1, height: 1 })
    ).toBitmap()
    assert.ok(
      [0, 1, 2].every((channel) => Math.abs(overlap[channel] - reference[channel]) <= 2),
      `Overlapping colors must multiply: ${[...overlap.slice(0, 4)]}, expected ${[...reference.slice(0, 4)]}`
    )
    await evaluate(`document.getElementById('blend-reference').remove()`)
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.visible .annotationLayer [data-annotation-id]').length`
      ),
      1,
      'Only the native form widget should remain; owned annotations must not create duplicate HTML'
    )
    await evaluate(
      `window.originalPageCanvas = document.querySelector('.visible .canvasWrapper canvas'); window.originalAnnotationLayer = document.querySelector('.visible .annotationEditorLayer')`
    )
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    await waitFor(
      `document.querySelector('.visible .annotationEditorLayer.highlightEditing') !== null`
    )
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`
      ),
      false,
      'Activating highlighting on an annotated PDF must not mark it modified'
    )
    console.log('PASS: activating highlighting leaves an annotated PDF clean')
    for (let i = 0; i < 3; i++) {
      await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
      await waitFor(
        `document.querySelector('.visible .annotationEditorLayer.highlightEditing') === null`
      )
      await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
      await waitFor(
        `document.querySelector('.visible .annotationEditorLayer.highlightEditing') !== null`
      )
    }
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`
      ),
      false,
      'Repeated tool changes must leave existing annotations clean'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.visible .canvasWrapper canvas') === window.originalPageCanvas`
      ),
      true,
      'Tool changes must not replace or redraw the page canvas'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.visible .annotationEditorLayer') === window.originalAnnotationLayer`
      ),
      true,
      'Tool changes must keep the loaded annotation layer'
    )
    await evaluate(
      `document.querySelector('.visible .highlightEditor').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0}))`
    )
    await chooseColor('Yellow', 'Yellow')
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`)
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') === null`)
    await highlightText('Second highlight', existingCount + 1)
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`)
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(() => saved.has('second.pdf'))
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') === null`)
    for (let i = 0; i < 2; i++) {
      await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
      await waitFor(
        `document.querySelector('.visible .annotationEditorLayer.highlightEditing') === null`
      )
      await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
      await waitFor(
        `document.querySelector('.visible .annotationEditorLayer.highlightEditing') !== null`
      )
    }
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`
      ),
      false,
      'Switching tools after saving must keep the document clean'
    )
    await evaluate(
      `document.querySelector('.visible .highlightEditor').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0})); window.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, button:0}))`
    )
    await waitFor(`document.querySelector('.visible .highlightEditor.selectedEditor') !== null`)
    await chooseColor('Yellow', 'Green')
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`)
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') === null`)
    await evaluate(`document.querySelector('.visible .highlightEditor.selectedEditor').focus()`)
    await waitFor(`document.hasFocus() && document.activeElement.matches('.highlightEditor')`)
    pressKey('Delete')
    await waitFor(
      `document.querySelectorAll('.visible .highlightEditor').length === ${existingCount}`
    )
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`)
    await evaluate(`void window.testCommands.run('undo')`)
    await waitFor(
      `document.querySelectorAll('.visible .highlightEditor').length === ${existingCount + 1}`
    )
    console.log(
      'PASS: repeated tool changes stay clean, while insertion, recoloring and deletion mark actual edits'
    )
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') === null`)
    await waitFor(`document.querySelector('.visible .annotationLayer input') !== null`)
    await evaluate(`(() => {
      const input = document.querySelector('.visible .annotationLayer input');
      input.value = 'updated form'; input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`)
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`)
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(() => saved.get('second.pdf').toString('latin1').includes('updated form'))
    console.log('PASS: native form fields remain editable and are saved alongside annotations')
    const editForm = async (text) =>
      evaluate(`(() => {
      const input = document.querySelector('.visible .annotationLayer input');
      input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`)
    holdSave = true
    await editForm('before disk write')
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(() => releaseSave !== null)
    await editForm('after disk write started')
    holdSave = false
    releaseSave()
    releaseSave = null
    await waitFor(`document.body.textContent.includes('Newer changes are still unsaved')`)
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`
      ),
      true
    )
    assert.ok(saved.get('second.pdf').toString('latin1').includes('before disk write'))
    assert.ok(!saved.get('second.pdf').toString('latin1').includes('after disk write started'))
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') === null`)
    assert.ok(saved.get('second.pdf').toString('latin1').includes('after disk write started'))
    console.log('PASS: edits during disk saving remain dirty and persist in the next save')
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
