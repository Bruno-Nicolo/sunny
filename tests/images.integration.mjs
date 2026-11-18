import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import { blankPdf, createPdf } from './fixtures/pdf.mjs'
const { app, BrowserWindow, clipboard, ipcMain } = electron
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-images-'))
app.setPath('userData', temp)
const pdf = Buffer.from(blankPdf)
const saved = new Map()
ipcMain.handle('test:read', (_, name) => ({
  path: name,
  name,
  directoryPath: 'test',
  source: { kind: 'memory', data: new Uint8Array(saved.get(name) ?? Buffer.from(pdf)).buffer },
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
  loadSession: async () => ({ tabs: [{path:'first.pdf',page:1,scale:'page-fit',scrollTop:0},{path:'second.pdf',page:1,scale:'page-fit',scrollTop:0}], activePath:'second.pdf', highlightColor: '#FDE047', highlightOpacity: 0.9, highlightThickness: 12, theme:'light' }),
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
async function movePastePointer(x, y) {
  return evaluate(`(() => {
    const page = document.querySelector('.visible .page');
    const rect = page.getBoundingClientRect();
    const point = {clientX: rect.left + rect.width * ${x}, clientY: rect.top + rect.height * ${y}};
    page.dispatchEvent(new PointerEvent('pointermove', {bubbles:true, ...point}));
    return point;
  })()`)
}
async function assertCenteredAtPointer(selector, point) {
  const rect = await evaluate(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {x:rect.left + rect.width / 2, y:rect.top + rect.height / 2};
  })()`)
  assert.ok(
    Math.hypot(rect.x - point.clientX, rect.y - point.clientY) < 2,
    `${selector} must be centered at the pointer: ${JSON.stringify({ rect, point })}`
  )
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
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') process.stderr.write(details.message + '\n')
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await enableTestFocus(win)
    await waitFor(
      `document.querySelector('[aria-label="Add text"]')?.disabled === false && !document.body.textContent.includes('Opening document')`
    )
    await evaluate(
      `(async () => { ${imageSetup} window.dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer,bubbles:true,cancelable:true})); })()`
    )
    await waitFor(count(1))
    console.log('PASS: image paste creates editable image')
    const imagePoint = await evaluate(`(() => {
      const rect = document.querySelector('.visible .stampEditor').getBoundingClientRect();
      return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
    })()`)
    for (const tool of ['Highlight text', 'Add text']) {
      await evaluate(`document.querySelector('[aria-label="${tool}"]').click()`)
      await waitFor(
        `document.querySelector('[aria-label="${tool}"]').getAttribute('aria-pressed') === 'true'`
      )
      win.webContents.sendInputEvent({ type: 'mouseMove', ...imagePoint })
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      assert.equal(
        await evaluate(`document.querySelector('.visible .stampEditor').matches(':hover')`),
        false,
        `${tool} must suppress image hover`
      )
      win.webContents.sendInputEvent({
        type: 'mouseDown',
        button: 'left',
        ...imagePoint,
        clickCount: 1
      })
      if (tool === 'Highlight text') {
        for (let i = 1; i <= 5; i++) {
          win.webContents.sendInputEvent({
            type: 'mouseMove',
            x: imagePoint.x + i * 3,
            y: imagePoint.y
          })
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
      }
      win.webContents.sendInputEvent({
        type: 'mouseUp',
        button: 'left',
        x: imagePoint.x + (tool === 'Highlight text' ? 15 : 0),
        y: imagePoint.y,
        clickCount: 1
      })
      await waitFor(
        tool === 'Highlight text'
          ? `document.querySelector('.visible .freehandHighlight') !== null`
          : `document.querySelector('.visible .freeTextEditor .internal')?.isContentEditable === true`
      )
      await evaluate(`window.testCommands.run('undo')`)
      await waitFor(
        `!document.querySelector('.visible .highlightEditor, .visible .freeTextEditor')`
      )
      await evaluate(`document.querySelector('[aria-label="${tool}"]').click()`)
      await waitFor(
        `document.querySelector('[aria-label="${tool}"]').getAttribute('aria-pressed') === 'false'`
      )
      assert.equal(
        await evaluate(
          `document.elementFromPoint(${imagePoint.x}, ${imagePoint.y}).closest('.stampEditor') !== null`
        ),
        true,
        'Deactivating the tool must restore image interaction'
      )
    }
    console.log('PASS: active tools suppress image hover and can draw or insert text over images')
    for (const rotation of [90, 180, 270, 0]) {
      await evaluate(`window.testCommands.run('rotate-clockwise')`)
      await waitFor(
        `document.querySelector('.visible .stampEditor canvas')?.style.transform.includes('rotate(${rotation}deg)')`
      )
      assert.equal(
        await evaluate(`(() => {
        const editor = document.querySelector('.visible .stampEditor').getBoundingClientRect();
        const canvas = document.querySelector('.visible .stampEditor canvas').getBoundingClientRect();
        return Math.abs(editor.width - canvas.width) < 1 && Math.abs(editor.height - canvas.height) < 1;
      })()`),
        true,
        'Rotating the page must rotate image pixels without stretching'
      )
      assert.equal(
        await evaluate(`(() => {
        const canvas = document.querySelector('.visible .stampEditor canvas');
        return Math.abs(canvas.offsetWidth / canvas.offsetHeight - 2) < 0.05;
      })()`),
        true,
        'Image layout must retain its aspect ratio before the rotation transform'
      )
      if (rotation === 90) {
        const width = await evaluate(
          `document.querySelector('.visible .stampEditor').getBoundingClientRect().width`
        )
        await evaluate(`(() => {
          const handle = document.querySelector('.visible .stampEditor .middleRight');
          handle.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,button:0,pointerId:2,screenX:100,screenY:100}));
          window.dispatchEvent(new PointerEvent('pointermove', {pointerId:2,screenX:130,screenY:100}));
          window.dispatchEvent(new PointerEvent('pointerup', {button:0,pointerId:2}));
        })()`)
        assert.ok(
          (await evaluate(
            `document.querySelector('.visible .stampEditor').getBoundingClientRect().width`
          )) >
            width + 29
        )
        await evaluate(`window.testCommands.run('undo')`)
        await waitFor(
          `Math.abs(document.querySelector('.visible .stampEditor').getBoundingClientRect().width - ${width}) < 1`
        )
      }
    }
    console.log('PASS: image geometry stays aligned through all four page rotations')

    await evaluate(`(() => {
      const editor = document.querySelector('.visible .stampEditor');
      editor.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, pointerId:1}));
      window.dispatchEvent(new PointerEvent('pointerup', {button:0, pointerId:1}));
    })()`)
    await waitFor(`document.querySelectorAll('.visible .stampEditor .resizer').length === 8`)
    clipboard.writeText('Before image copy')
    win.webContents.copy()
    await waitFor(
      `navigator.clipboard.read().then(items => items.some(item => item.types.includes('image/png')))`
    )
    const copiedImage = clipboard.readImage()
    assert.deepEqual(copiedImage.getSize(), { width: 80, height: 40 })
    const copiedPixel = copiedImage.toBitmap()
    assert.deepEqual([...copiedPixel.subarray(0, 4)], [0, 0, 255, 255])
    console.log('PASS: native Copy writes the selected image pixels to the system clipboard')
    assert.equal(
      await evaluate(`document.querySelector('.visible .stampEditor .editToolbar')`),
      null,
      'Image annotations have no local toolbar'
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
    const imagePointer = await movePastePointer(0.2, 0.35)
    await evaluate(
      `(async () => { ${imageSetup} document.querySelector('.visible .pdf-viewer-container').dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer,bubbles:true,cancelable:true})); })()`
    )
    await waitFor(count(2))
    await assertCenteredAtPointer('.visible .stampEditor:last-of-type', imagePointer)
    assert.equal(await evaluate(`document.querySelectorAll('.invisible .stampEditor').length`), 0)
    console.log('PASS: clipboard image goes only to active tab')
    const textPointer = await movePastePointer(0.64, 0.68)
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'Pasted text\\r\\nSecond line');
      transfer.setData('text/html', '<b>Pasted text</b><br>Second line');
      document.querySelector('.visible .pdf-viewer-container').dispatchEvent(
        new ClipboardEvent('paste', {clipboardData:transfer, bubbles:true, cancelable:true})
      );
    })()`)
    await waitFor(
      `document.querySelector('.visible .freeTextEditor .internal')?.innerText === 'Pasted text\\nSecond line'`
    )
    assert.equal(await evaluate(`document.querySelectorAll('.freeTextEditor').length`), 1)
    await assertCenteredAtPointer('.visible .freeTextEditor', textPointer)
    assert.equal(
      await evaluate(`document.querySelector('.visible .freeTextEditor .internal b')`),
      null
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.visible .freeTextEditor .internal').isContentEditable`
      ),
      false,
      'Pasted text must be selected for moving before editing'
    )
    const textLeft = await evaluate(`document.querySelector('.visible .freeTextEditor').style.left`)
    await evaluate(`(() => {
      const input = document.querySelector('.visible .freeTextEditor .internal');
      input.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, pointerId:1, clientX:100, clientY:100}));
      window.dispatchEvent(new PointerEvent('pointermove', {pointerId:1, clientX:120, clientY:110}));
      window.dispatchEvent(new PointerEvent('pointerup', {button:0, pointerId:1}));
    })()`)
    assert.notEqual(
      await evaluate(`document.querySelector('.visible .freeTextEditor').style.left`),
      textLeft
    )
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(
      `document.querySelector('.visible .freeTextEditor').style.left === ${JSON.stringify(textLeft)}`
    )
    clipboard.writeText('Before text copy')
    win.webContents.copy()
    await waitFor(
      `navigator.clipboard.readText().then(text => text === 'Pasted text\\nSecond line')`
    )
    console.log('PASS: native Copy writes the whole selected text block to the system clipboard')
    await evaluate(
      `document.querySelector('.visible .freeTextEditor .internal').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.visible .freeTextEditor .internal').isContentEditable`
      ),
      true,
      'Double-clicking pasted text must start editing'
    )
    await evaluate(`(() => {
      const input = document.querySelector('.visible .freeTextEditor .internal');
      input.focus();
      window.getSelection().setBaseAndExtent(input.firstChild, 0, input.firstChild, 6);
    })()`)
    win.webContents.copy()
    await waitFor(`navigator.clipboard.readText().then(text => text === 'Pasted')`)
    console.log('PASS: copying during text editing preserves the native character selection')
    for (const selector of ['.visible .freeTextEditor .internal', '[aria-label="Current page"]']) {
      assert.equal(
        await evaluate(`(() => {
        const transfer = new DataTransfer();
        transfer.setData('text/plain', 'Inline paste');
        return document.querySelector(${JSON.stringify(selector)}).dispatchEvent(
          new ClipboardEvent('paste', {clipboardData:transfer, bubbles:true, cancelable:true})
        );
      })()`),
        true,
        'Text fields must retain native paste behavior'
      )
    }
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(`document.querySelector('.freeTextEditor') === null`)
    await evaluate(`window.testCommands.run('redo')`)
    await waitFor(
      `document.querySelector('.visible .freeTextEditor .internal')?.innerText === 'Pasted text\\nSecond line'`
    )
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(`document.querySelector('.freeTextEditor') === null`)
    console.log(
      'PASS: plain text paste targets the active tab, preserves editing and supports undo/redo'
    )
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
      `const transfer = new DataTransfer(); transfer.items.add(new File(['invalid'], 'broken.png', {type:'image/png'})); window.dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer,bubbles:true,cancelable:true}));`
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
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(count(2))
    await evaluate(`window.testCommands.run('save')`)
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > span.size-2') === null`)
    assert.equal(
      (
        saved
          .get('second.pdf')
          .toString('latin1')
          .match(/\/Subtype\s*\/Stamp/g) ?? []
      ).length,
      2
    )
    await evaluate(`window.testCommands.run('redo')`)
    await waitFor(count(3))
    await evaluate(`window.testCommands.run('save')`)
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > span.size-2') === null`)
    assert.equal(
      (
        saved
          .get('second.pdf')
          .toString('latin1')
          .match(/\/Subtype\s*\/Stamp/g) ?? []
      ).length,
      3
    )
    console.log('PASS: repeated image saves use fresh bitmaps and preserve undo/redo')

    await new Promise((resolve) => {
      win.webContents.once('did-finish-load', resolve)
      win.reload()
    })
    await waitFor(
      `document.querySelector('[aria-label="Add text"]')?.disabled === false && !document.body.textContent.includes('Opening document')`
    )
    await waitFor(count(3))
    assert.equal(
      await evaluate(`Array.from(document.querySelectorAll('.visible .stampEditor canvas')).every(canvas => {
      const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      return pixel[0] > 240 && pixel[1] < 10 && pixel[2] < 10 && pixel[3] > 240;
    })`),
      true,
      'Imported image appearances must retain their pixels'
    )

    await evaluate(
      `(async () => { ${imageSetup} window.dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer,bubbles:true,cancelable:true})); })()`
    )
    await waitFor(count(4))
    console.log('PASS: saved images remain editable after reopening')
    const appearance = '1 0 0 rg 0 0 100 100 re f'
    saved.set(
      'second.pdf',
      Buffer.from(
        createPdf([
          '<< /Type /Catalog /Pages 2 0 R >>',
          '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
          '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 16000 20000] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>',
          '<< /Length 0 >>\nstream\n\nendstream',
          '<< /Type /Annot /Subtype /Stamp /Rect [100 100 200 200] /F 4 /AP << /N 6 0 R >> >>',
          `<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << >> /Length ${appearance.length} >>\nstream\n${appearance}\nendstream`
        ])
      )
    )
    win.webContents.on('dom-ready', () => {
      void evaluate(`(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(...args) {
          if (this.width * this.height > 16 * 1024 * 1024) throw new Error('Unexpected full poster allocation');
          return original.apply(this, args);
        };
      })()`)
    })
    await new Promise((resolve) => {
      win.webContents.once('did-finish-load', resolve)
      win.reload()
    })
    await waitFor(count(1))
    assert.equal(
      await evaluate(`(() => {
      const canvas = document.querySelector('.visible .stampEditor canvas');
      const pixel = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return pixel[0] > 240 && pixel[1] < 10 && pixel[2] < 10 && pixel[3] > 240;
    })()`),
      true,
      'A stamp on a poster must preserve its appearance without a page-sized temporary canvas'
    )
    console.log('PASS: importing a stamp on a giant poster uses bounded temporary canvas memory')
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
