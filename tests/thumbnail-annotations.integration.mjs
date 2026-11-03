import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import { createPdf } from './fixtures/pdf.mjs'
const { app, BrowserWindow, ipcMain } = electron
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-thumbnail-annotations-'))
app.setPath('userData', temp)
const existingCount = 3
const rotation = Number(process.env.LEPIS_THUMBNAIL_ROTATION ?? 0)
const originalText = 'BT /F1 24 Tf 72 700 Td (First highlight) Tj 0 -40 Td (Second highlight) Tj ET'
const pdf = Buffer.from(
  createPdf([
    `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${existingCount + 6} 0 R] /DR << /Font << /Helv 5 0 R >> >> >> >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate ${rotation} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [${Array.from({ length: existingCount }, (_, index) => `${6 + index} 0 R`).join(' ')} ${existingCount + 6} 0 R] >>`,
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
ipcMain.handle('test:read', (_, name) => ({
  path: name,
  name,
  directoryPath: 'test',
  source: { kind: 'memory', data: new Uint8Array(saved.get(name) ?? pdf).buffer },
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
  releasePdfSource: async () => {},
  loadDrafts: async () => [], saveDraft: async () => {}, deleteDraft: async () => {},
  setTheme: () => {},
  loadSession: async () => ({ tabs: [{path:'second.pdf',page:1,scale:'page-fit',scrollTop:0}], activePath:'second.pdf', highlightColor:'#FDE047', theme:'light' }),
  readPdf: path => ipcRenderer.invoke('test:read', path),
  savePdf: payload => ipcRenderer.invoke('test:save', payload),
  statPdf: async () => ({mtimeMs:1,size:${pdf.length}}), saveSession: async () => {},
  closePdf: async () => {}, openPdfDialog: async () => [], getPathForFile: () => '', confirmWindowClose: () => {},
  onOpenRequested: () => () => {}, onCommand: (name, cb) => { handlers.set(name,cb); return () => handlers.delete(name) }
})
contextBridge.exposeInMainWorld('testCommands', {run: name => handlers.get(name)?.()})`
)
let win
const evaluate = (code) =>
  win.webContents.executeJavaScript(code).catch((error) => {
    throw new Error(`${error.message}\n${code}`, { cause: error })
  })
async function waitFor(code) {
  const check = typeof code === 'function' ? code : () => evaluate(code)
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > 15000) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
async function thumbnailPixel(x, y) {
  const [vx, vy, w, h] =
    rotation === 90
      ? [y, x, 792, 612]
      : rotation === 180
        ? [612 - x, y, 612, 792]
        : rotation === 270
          ? [792 - y, 612 - x, 792, 612]
          : [x, 792 - y, 612, 792]
  return evaluate(
    `(() => {const c=document.querySelector('[aria-label="Go to page 1"] canvas');if(!c?.width || !c.height)return [0,0,0,0];return Array.from(c.getContext('2d').getImageData(Math.round(${vx}*c.width/${w}),Math.round(${vy}*c.height/${h}),1,1).data)})()`
  )
}
async function editorPixel(selector, fraction) {
  return evaluate(`(() => {
    const editor=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const page=document.querySelector('.visible .page').getBoundingClientRect();
    const c=document.querySelector('[aria-label="Go to page 1"] canvas');
    if(!c?.width || !c.height)return [0,0,0,0];
    return Array.from(c.getContext('2d').getImageData(Math.round((editor.left-page.left+editor.width*${fraction})*c.width/page.width),Math.round((editor.top-page.top+editor.height/2)*c.height/page.height),1,1).data);
  })()`)
}
async function redTextPixels() {
  return evaluate(`(() => {
    const editor=document.querySelector('.visible .freeTextEditor').getBoundingClientRect();
    const page=document.querySelector('.visible .page').getBoundingClientRect();
    const c=document.querySelector('[aria-label="Go to page 1"] canvas');
    if(!c?.width || !c.height)return 0;
    const data=c.getContext('2d').getImageData(Math.floor((editor.left-page.left)*c.width/page.width),Math.floor((editor.top-page.top)*c.height/page.height),Math.ceil(editor.width*c.width/page.width),Math.ceil(editor.height*c.height/page.height)).data;
    let red=0;for(let i=0;i<data.length;i+=4)if(data[i]>150 && data[i+1]<150 && data[i+2]<150)red++;return red;
  })()`)
}
async function toggleNavigation() {
  await evaluate(`document.querySelector('[aria-label="Toggle PDF navigation"]').click()`)
}
async function pasteText(text) {
  await evaluate(
    `(() => {const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(text)});document.querySelector('.visible .pdf-viewer-container').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`
  )
}
async function removeSelected(selector) {
  const count = await evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  await evaluate(
    `(() => {const editor=document.querySelector(${JSON.stringify(selector)});editor.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}));window.dispatchEvent(new PointerEvent('pointerup',{pointerId:1}));editor.focus()})()`
  )
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' })
  await waitFor(`document.querySelectorAll(${JSON.stringify(selector)}).length === ${count - 1}`)
}
async function openNavigation() {
  await toggleNavigation()
  await waitFor(`document.querySelector('[aria-label="Go to page 1"] canvas')?.width > 0`)
}
async function closeNavigation() {
  await evaluate(`document.querySelector('[data-slot="dialog-close"]').click()`)
  await waitFor(`document.querySelector('[role="dialog"]') === null`)
}
async function checkImage() {
  await waitFor(async () => {
    const red = await editorPixel('.visible .stampEditor', 0.25)
    const blue = await editorPixel('.visible .stampEditor', 0.75)
    return red[0] > 240 && red[2] < 20 && blue[2] > 240 && blue[0] < 20
  })
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
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === 3`)
    await openNavigation()
    await waitFor(async () => {
      const pixel = await thumbnailPixel(220, 710)
      return pixel[0] > 240 && pixel[1] > 240 && pixel[2] < 100 && pixel[3] === 255
    })
    const overlap = await thumbnailPixel(325, 425)
    assert.ok(
      overlap[0] > 140 &&
        overlap[0] < 165 &&
        overlap[1] > 80 &&
        overlap[1] < 105 &&
        overlap[2] > 140 &&
        overlap[2] < 165,
      'Overlapping highlights blend their colors'
    )
    await closeNavigation()
    console.log('PASS: modal previews retain saved highlights and blend overlapping colors')

    await pasteText('Large pasted text\nSecond line')
    await waitFor(`document.querySelector('.visible .freeTextEditor') !== null`)
    await evaluate(
      `(() => {const input=document.querySelector('.visible .freeTextEditor .internal');input.innerText='Edited text\\nAnother line';input.dispatchEvent(new Event('input',{bubbles:true}))})()`
    )
    await evaluate(`document.querySelector('[aria-label="Text settings"]').click()`)
    await waitFor(`document.querySelector('[aria-label="Text size"]') !== null`)
    await evaluate(
      `Array.from(document.querySelectorAll('[aria-label="Text size"] button')).find(button=>button.textContent==='24 pt').click()`
    )
    await evaluate(`document.querySelector('[aria-label="Text color"] [aria-label="Red"]').click()`)
    await evaluate(`document.querySelector('[aria-label="Text settings"]').click()`)
    await openNavigation()
    await waitFor(async () => (await redTextPixels()) > 10)
    await closeNavigation()
    await removeSelected('.visible .freeTextEditor')
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(`document.querySelector('.visible .freeTextEditor') !== null`)
    await openNavigation()
    await waitFor(async () => (await redTextPixels()) > 10)
    await closeNavigation()
    console.log('PASS: reopening previews reflects pasted text, formatting, deletion and undo')

    await evaluate(`(async () => {
      const c=document.createElement('canvas');c.width=160;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,80,100);ctx.fillStyle='blue';ctx.fillRect(80,0,80,100);
      const blob=await new Promise(resolve=>c.toBlob(resolve));const data=new DataTransfer();data.items.add(new File([blob],'pasted.png',{type:'image/png'}));
      document.querySelector('.visible .pdf-viewer-container').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    })()`)
    await waitFor(`document.querySelector('.visible .stampEditor') !== null`)
    await openNavigation()
    await checkImage()
    await closeNavigation()
    await removeSelected('.visible .stampEditor')
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(`document.querySelector('.visible .stampEditor') !== null`)
    await openNavigation()
    await checkImage()
    await closeNavigation()
    console.log('PASS: image previews preserve both colors after deletion and undo')

    await evaluate(
      `(() => {document.querySelector('.visible .highlightEditor').focus();document.querySelector('[aria-label="Highlight color: Yellow"]').click()})()`
    )
    await waitFor(`document.querySelector('[aria-label="Green"]') !== null`)
    await evaluate(`document.querySelector('[aria-label="Green"]').click()`)
    await openNavigation()
    await waitFor(async () => {
      const p = await thumbnailPixel(220, 710)
      return p[1] > p[0] && p[1] > p[2]
    })
    await closeNavigation()
    await removeSelected('.visible .highlightEditor')
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === 3`)
    await openNavigation()
    await waitFor(async () => {
      const p = await thumbnailPixel(220, 710)
      return p[1] > p[0] && p[1] > p[2]
    })
    await closeNavigation()
    console.log('PASS: reopened previews reflect highlight recoloring, deletion and undo')

    await evaluate(`(() => {
      const span=[...document.querySelectorAll('.visible .textLayer span')].find(s=>s.textContent==='Second highlight');
      const range=document.createRange();range.selectNodeContents(span);window.getSelection().removeAllRanges();window.getSelection().addRange(range);
    })()`)
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === 4`)
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === 3`)
    await evaluate(`window.testCommands.run('redo')`)
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === 4`)
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(() => saved.has('second.pdf'))
    await win.reload()
    await enableTestFocus(win)
    await waitFor(
      `document.querySelectorAll('.visible .stampEditor').length === 1 && document.querySelectorAll('.visible .freeTextEditor').length === 1 && document.querySelectorAll('.visible .highlightEditor').length === 4`
    )
    await openNavigation()
    await checkImage()
    await waitFor(async () => (await redTextPixels()) > 10)
    console.log(
      'PASS: saved text, images and highlights remain in previews after reopening the document'
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
