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
    `(() => {const c=document.querySelector('.visible [aria-label="Go to page 1"] canvas');return Array.from(c.getContext('2d').getImageData(Math.round(${vx}*c.width/${w}),Math.round(${vy}*c.height/${h}),1,1).data)})()`
  )
}
async function editorPixel(selector, fraction) {
  return evaluate(`(() => {
    const editor=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const page=document.querySelector('.visible .page').getBoundingClientRect();
    const c=document.querySelector('.visible [aria-label="Go to page 1"] canvas');
    return Array.from(c.getContext('2d').getImageData(Math.round((editor.left-page.left+editor.width*${fraction})*c.width/page.width),Math.round((editor.top-page.top+editor.height/2)*c.height/page.height),1,1).data);
  })()`)
}
async function redTextPixels() {
  return evaluate(`(() => {
    const editor=document.querySelector('.visible .freeTextEditor').getBoundingClientRect();
    const page=document.querySelector('.visible .page').getBoundingClientRect();
    const c=document.querySelector('.visible [aria-label="Go to page 1"] canvas');
    const data=c.getContext('2d').getImageData(Math.floor((editor.left-page.left)*c.width/page.width),Math.floor((editor.top-page.top)*c.height/page.height),Math.ceil(editor.width*c.width/page.width),Math.ceil(editor.height*c.height/page.height)).data;
    let red=0;for(let i=0;i<data.length;i+=4)if(data[i]>150 && data[i+1]<150 && data[i+2]<150)red++;return red;
  })()`)
}
async function thumbnailHash() {
  return evaluate(
    `(() => {const c=document.querySelector('.visible [aria-label="Go to page 1"] canvas');if(!c?.width || !c.height)return null;let hash=0;for(const value of c.getContext('2d').getImageData(0,0,c.width,c.height).data)hash=(hash*31+value)|0;return hash})()`
  )
}
async function waitForChange(before) {
  await waitFor(async () => {
    const hash = await thumbnailHash()
    return hash !== null && hash !== before
  })
}
async function toggleSidebar() {
  await evaluate(`document.querySelector('[aria-label="Toggle PDF sidebar"]').click()`)
}
async function pasteText(text) {
  await evaluate(
    `(() => {const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(text)});document.querySelector('.visible .pdf-viewer-container').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`
  )
}
async function removeSelected(selector) {
  await evaluate(
    `(() => {const editor=document.querySelector(${JSON.stringify(selector)});editor.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}));window.dispatchEvent(new PointerEvent('pointerup',{pointerId:1}));editor.focus()})()`
  )
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' })
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
    await waitFor(
      `document.querySelector('.visible [aria-label="Go to page 1"] canvas')?.width > 0`
    )
    // Regenerate after the main viewer has imported its originals: this used to omit highlights.
    await toggleSidebar()
    await waitFor(`!document.querySelector('.visible [aria-label="PDF navigation"]')`)
    await toggleSidebar()
    await waitFor(
      `document.querySelector('.visible [aria-label="Go to page 1"] canvas')?.width > 0`
    )
    await waitFor(async () => {
      const pixel = await thumbnailPixel(220, 710)
      return pixel[0] > 240 && pixel[1] > 240 && pixel[2] < 100 && pixel[3] === 255
    })
    console.log('PASS: regenerated thumbnails retain saved highlights')
    await evaluate(`(() => {
      window.pdfTextPaints=0;
      const fill=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(...args){if(!this.canvas.isConnected)window.pdfTextPaints++;return fill.apply(this,args)};
    })()`)
    const overlap = await thumbnailPixel(325, 425)
    assert.ok(
      overlap[0] > 140 &&
        overlap[0] < 165 &&
        overlap[1] > 80 &&
        overlap[1] < 105 &&
        overlap[2] > 140 &&
        overlap[2] < 165,
      'Overlapping highlights must blend their colors'
    )
    let before = await thumbnailHash()
    await pasteText('Large pasted text\nSecond line')
    await waitFor(`document.querySelectorAll('.visible .freeTextEditor').length === 1`)
    await waitForChange(before)
    before = await thumbnailHash()
    await evaluate(
      `(() => {const input=document.querySelector('.visible .freeTextEditor .internal');input.innerText='Edited text\\nAnother line';input.dispatchEvent(new Event('input',{bubbles:true}))})()`
    )
    await waitForChange(before)
    before = await thumbnailHash()
    await evaluate(`document.querySelector('[aria-label="Text settings"]').click()`)
    await waitFor(`document.querySelector('[aria-label="Text size"]') !== null`)
    await evaluate(
      `Array.from(document.querySelectorAll('[aria-label="Text size"] button')).find(button=>button.textContent==='24 pt').click()`
    )
    await waitForChange(before)
    before = await thumbnailHash()
    await evaluate(`document.querySelector('[aria-label="Text color"] [aria-label="Red"]').click()`)
    await waitForChange(before)
    await waitFor(async () => (await redTextPixels()) > 10)
    await evaluate(`document.querySelector('[aria-label="Text settings"]').click()`)
    const textHash = await thumbnailHash()
    await removeSelected('.visible .freeTextEditor')
    await waitForChange(textHash)
    before = await thumbnailHash()
    await evaluate(`window.testCommands.run('undo')`)
    await waitForChange(before)
    await waitFor(async () => (await thumbnailHash()) === textHash)
    console.log('PASS: pasted text, live editing, size, color, deletion and undo update thumbnails')

    before = await thumbnailHash()
    await evaluate(`(async () => {
      const c=document.createElement('canvas');c.width=160;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,80,100);ctx.fillStyle='blue';ctx.fillRect(80,0,80,100);
      const blob=await new Promise(resolve=>c.toBlob(resolve));const data=new DataTransfer();data.items.add(new File([blob],'pasted.png',{type:'image/png'}));
      document.querySelector('.visible .pdf-viewer-container').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    })()`)
    await waitFor(`document.querySelectorAll('.visible .stampEditor').length === 1`)
    await waitForChange(before)
    const imageHash = await thumbnailHash()
    const red = await editorPixel('.visible .stampEditor', 0.25),
      blue = await editorPixel('.visible .stampEditor', 0.75)
    assert.ok(
      red[0] > 240 && red[2] < 20 && blue[2] > 240 && blue[0] < 20,
      'Pasted image pixels must retain both colors'
    )
    await evaluate(`(() => {
      const editor=document.querySelector('.visible .stampEditor');editor.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,clientX:300,clientY:300}));window.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:340,clientY:340}));window.dispatchEvent(new PointerEvent('pointerup',{pointerId:1}));
    })()`)
    await waitForChange(imageHash)
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(async () => (await thumbnailHash()) === imageHash)
    await evaluate(`(() => {
      const handle=document.querySelector('.visible .stampEditor .middleRight');handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:2,screenX:100,screenY:100}));window.dispatchEvent(new PointerEvent('pointermove',{pointerId:2,screenX:150,screenY:100}));window.dispatchEvent(new PointerEvent('pointerup',{pointerId:2}));
    })()`)
    await waitForChange(imageHash)
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(async () => (await thumbnailHash()) === imageHash)
    await removeSelected('.visible .stampEditor')
    await waitForChange(imageHash)
    before = await thumbnailHash()
    await evaluate(`window.testCommands.run('undo')`)
    await waitForChange(before)
    await waitFor(async () => (await thumbnailHash()) === imageHash)
    console.log(
      'PASS: pasted image colors, movement, resizing, deletion and undo update thumbnails'
    )

    before = await thumbnailHash()
    await evaluate(
      `(() => {document.querySelectorAll('.visible .highlightEditor')[0].focus();document.querySelector('[aria-label="Highlight color: Yellow"]').click()})()`
    )
    await waitFor(`document.querySelector('[aria-label="Green"]') !== null`)
    await evaluate(`document.querySelector('[aria-label="Green"]').click()`)
    await waitForChange(before)
    before = await thumbnailHash()
    await removeSelected('.visible .highlightEditor')
    await waitForChange(before)
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(async () => (await thumbnailHash()) === before)
    console.log('PASS: highlight recoloring, deletion and undo update thumbnails')

    before = await thumbnailHash()
    await evaluate(`(() => {
      const span=[...document.querySelectorAll('.visible .textLayer span')].find(s=>s.textContent==='Second highlight');
      const range=document.createRange();range.selectNodeContents(span);window.getSelection().removeAllRanges();window.getSelection().addRange(range);
    })()`)
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length===4`)
    await waitForChange(before)
    const createdHash = await thumbnailHash()
    await evaluate(`window.testCommands.run('undo')`)
    await waitForChange(createdHash)
    await evaluate(`window.testCommands.run('redo')`)
    await waitFor(async () => (await thumbnailHash()) === createdHash)
    assert.equal(
      await evaluate('window.pdfTextPaints'),
      0,
      'Annotation changes must not render the PDF page again'
    )
    console.log(
      'PASS: new highlights and redo update thumbnails without rendering PDF content again'
    )
    before = await thumbnailHash()
    await evaluate(`(() => {
      const [x,y,w,h] = ${JSON.stringify(rotation === 90 ? [200, 450, 792, 612] : rotation === 180 ? [162, 200, 612, 792] : rotation === 270 ? [592, 162, 792, 612] : [450, 592, 612, 792])};
      const bounds = document.querySelector('.visible .lepisAnnotationLayer').getBoundingClientRect();
      const input = { bubbles: true, pointerId: 42, button: 0,
        clientX: bounds.left + x * bounds.width / w, clientY: bounds.top + y * bounds.height / h };
      document.querySelector('.visible .textLayer').dispatchEvent(new PointerEvent('pointerdown', input));
      window.dispatchEvent(new PointerEvent('pointerup', input));
    })()`)
    await waitFor(`document.querySelectorAll('.visible .freehandHighlight').length === 1`)
    await waitForChange(before)
    const dotPixel = await thumbnailPixel(450, 200)
    assert.ok(
      dotPixel[0] < 220 && dotPixel[1] > 220 && dotPixel[2] < 220,
      `A single-point freehand stroke must paint green in thumbnails, got ${dotPixel}`
    )
    const dotHash = await thumbnailHash()
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(async () => (await thumbnailHash()) === before)
    await evaluate(`window.testCommands.run('redo')`)
    await waitFor(async () => (await thumbnailHash()) === dotHash)
    console.log('PASS: single-point freehand strokes paint in thumbnails and support undo and redo')
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(() => saved.has('second.pdf'))
    await win.reload()
    await enableTestFocus(win)
    await waitFor(
      `document.querySelectorAll('.visible .stampEditor').length === 1 && document.querySelectorAll('.visible .freeTextEditor').length === 1 && document.querySelectorAll('.visible .highlightEditor').length === 5`
    )
    await waitFor(
      `document.querySelector('.visible [aria-label="Go to page 1"] canvas')?.width > 0`
    )
    await waitFor(
      async () =>
        (await editorPixel('.visible .stampEditor', 0.25))[0] > 240 &&
        (await editorPixel('.visible .stampEditor', 0.25))[2] < 20
    )
    await waitFor(async () => (await redTextPixels()) > 10)
    await waitFor(async () => {
      const pixel = await thumbnailPixel(450, 200)
      return pixel.every((value, index) => Math.abs(value - dotPixel[index]) <= 2)
    })
    fs.writeFileSync(
      '/tmp/lepis-thumbnail-annotations-' + rotation + '.png',
      (await win.webContents.capturePage()).toPNG()
    )
    console.log('PASS: saved text, image and highlights remain in thumbnails after reopening')
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
