import electron from 'electron'
import { enableTestFocus } from './fixtures/focus.mjs'
import { blankPdf } from './fixtures/pdf.mjs'
import { createSignatureStore } from './fixtures/signature-store.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sunny-signatures-'))
app.setPath('userData', temp)
const store = createSignatureStore(temp)
const saved = new Map()
for (const action of ['list', 'create', 'remove'])
  ipcMain.handle(`signatures:${action}`, (_event, ...args) => store[action](...args))
const renames = []
let failRename = false
ipcMain.handle('signatures:rename', (_event, id, name) => {
  renames.push(name)
  if (failRename) throw new Error('Test rename failure')
  return store.rename(id, name)
})
ipcMain.handle('test:read', (_, name) => ({
  path: name,
  name,
  directoryPath: 'test',
  source: { kind: 'memory', data: new Uint8Array(saved.get(name) ?? Buffer.from(blankPdf)).buffer },
  mtimeMs: 1,
  size: blankPdf.length
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
  signatures: {
    list: () => ipcRenderer.invoke('signatures:list'),
    create: (dataUrl) => ipcRenderer.invoke('signatures:create', dataUrl),
    rename: (id, name) => ipcRenderer.invoke('signatures:rename', id, name),
    remove: id => ipcRenderer.invoke('signatures:remove', id)
  },
  releasePdfSource: async () => {}, loadDrafts: async () => [], saveDraft: async () => {}, deleteDraft: async () => {},
  setTheme: () => {},
  loadSession: async () => ({tabs:[{path:'first.pdf',page:1,scale:'page-fit',scrollTop:0},{path:'second.pdf',page:1,scale:'page-fit',scrollTop:0}],activePath:'second.pdf',highlightColor:'#FDE047',highlightOpacity:0.9,highlightThickness:12,theme:'light'}),
  readPdf: name => ipcRenderer.invoke('test:read', name), savePdf: payload => ipcRenderer.invoke('test:save', payload),
  statPdf: async () => ({mtimeMs:1,size:1}), saveSession: async () => {}, closePdf: async () => {},
  openPdfDialog: async () => [], getPathForFile: () => '', confirmWindowClose: () => {},
  onOpenRequested: () => () => {}, onCommand: (name, cb) => {handlers.set(name,cb);return () => handlers.delete(name)}
})
contextBridge.exposeInMainWorld('testCommands', {run: name => handlers.get(name)?.()})`
)
let win
const evaluate = (code) => win.webContents.executeJavaScript(code)
async function waitFor(code) {
  const start = Date.now()
  while (!(await evaluate(code))) {
    if (Date.now() - start > 15000) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
async function button(text, selector = 'button') {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(button => (button.getAttribute('aria-label') ?? button.textContent.trim()) === ${JSON.stringify(text)});
    if (!button || button.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(text)});
    button.click();
  })()`)
}
async function signatureAction(action) {
  await evaluate(`document.querySelector('[data-signature-options] button[aria-haspopup="menu"]')
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
  await waitFor(`document.querySelector('[role="menuitem"]') !== null`)
  await button(action, '[role="menuitem"]')
}
async function input(selector, value) {
  await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
}
const renameInput = '[aria-label="Rename signature"]'

async function editSignatureName(name) {
  await signatureAction('Rename')
  await waitFor(`document.activeElement.matches('${renameInput}')`)
  await input(renameInput, name)
}

async function renameKey(key, isComposing = false) {
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
    key: ${JSON.stringify(key)}, isComposing: ${isComposing}, bubbles: true, cancelable: true
  }))`)
}

const count = (n) => `document.querySelectorAll('.visible .stampEditor canvas').length === ${n}`
async function openLibrary() {
  await evaluate(
    `if (!document.querySelector('[data-signature-options]')) document.querySelector('[aria-label="Add signature"]').click()`
  )
  await waitFor(
    `document.querySelector('[role="complementary"][aria-label="Signature tool settings"]') && !document.body.textContent.includes('Loading signatures')`
  )
}
async function draw() {
  await waitFor(
    `document.querySelector('[role="dialog"] [aria-label="Draw your signature"]')?.getBoundingClientRect().width > 0`
  )
  const bounds = await evaluate(
    `(() => { const r=document.querySelector('[aria-label="Draw your signature"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`
  )
  const points = [
    [0.15, 0.65],
    [0.2, 0.3],
    [0.25, 0.65],
    [0.4, 0.4],
    [0.5, 0.6],
    [0.65, 0.3],
    [0.8, 0.5]
  ].map(([x, y]) => ({
    x: Math.round(bounds.x + bounds.width * x),
    y: Math.round(bounds.y + bounds.height * y)
  }))
  win.webContents.sendInputEvent({ type: 'mouseMove', ...points[0] })
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...points[0] })
  for (const point of points.slice(1)) {
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    await evaluate('new Promise(requestAnimationFrame)')
  }
  win.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    ...points.at(-1)
  })
  await waitFor(`document.querySelector('img[alt="Signature preview"]') !== null`)
}

async function place(n, x = 0.5, y = 0.55) {
  await waitFor(`document.querySelector('.signature-placement-hint') !== null`)
  const point = await evaluate(`(() => {
    const page = document.querySelector('.visible .page'); const rect = page.getBoundingClientRect();
    const point = {clientX:rect.left+rect.width*${x},clientY:rect.top+rect.height*${y}};
    page.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,...point})); return point;
  })()`)
  const preview = await evaluate(
    `(() => {const rect = document.querySelector('.signature-placement-preview').getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};})()`
  )
  assert.ok(preview.width > 0)
  const nativePoint = { x: Math.round(point.clientX), y: Math.round(point.clientY) }
  win.webContents.sendInputEvent({ type: 'mouseMove', ...nativePoint })
  win.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    ...nativePoint
  })
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...nativePoint })
  await waitFor(count(n))
  assert.equal(await evaluate(`document.querySelector('.signature-placement-hint') === null`), true)
  const actual = await evaluate(
    `(() => {const rect = [...document.querySelectorAll('.visible .stampEditor')].at(-1).getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};})()`
  )
  for (const key of ['x', 'y', 'width', 'height'])
    assert.ok(Math.abs(actual[key] - preview[key]) < 2, `${key}: preview must match insertion`)
}

app
  .whenReady()
  .then(async () => {
    win = new BrowserWindow({
      show: false,
      width: 1180,
      height: 900,
      webPreferences: {
        backgroundThrottling: false,
        preload,
        sandbox: true,
        contextIsolation: true
      }
    })
    const errors = []
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') {
        errors.push(details.message)
        console.error(details.message)
      }
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await enableTestFocus(win)
    await waitFor(`document.querySelector('[aria-label="Add signature"]')?.disabled === false`)
    await openLibrary()
    await draw()
    await evaluate(`document.querySelector('[aria-label="Undo stroke"]').click()`)
    assert.equal(
      await evaluate(`document.querySelector('img[alt="Signature preview"]') === null`),
      true
    )
    await evaluate(`document.querySelector('[aria-label="Redo stroke"]').click()`)
    await waitFor(`document.querySelector('img[alt="Signature preview"]') !== null`)
    await evaluate(`document.querySelector('button[aria-label="Clear signature"]').click()`)
    await waitFor(`document.querySelector('img[alt="Signature preview"]') === null`)
    await evaluate(`document.querySelector('[aria-label="Undo stroke"]').click()`)
    await waitFor(`document.querySelector('img[alt="Signature preview"]') !== null`)
    await evaluate(`document.querySelector('[aria-label="Redo stroke"]').click()`)
    await waitFor(`document.querySelector('img[alt="Signature preview"]') === null`)
    await draw()
    await button('Cancel')
    assert.equal(await evaluate(count(0)), true)
    assert.deepEqual(await store.list(), [])
    console.log(
      'PASS: empty library opens the editor; undo/redo, undoable clear and cancellation leave document and library unchanged'
    )

    await openLibrary()
    await draw()
    await button('Create')
    await place(1)
    assert.deepEqual(
      (await store.list()).map(({ name }) => name),
      ['signature 1']
    )
    await evaluate(`window.testCommands.run('save')`)
    await waitFor(`document.body.textContent.includes('Saved')`)
    assert.equal(saved.has('first.pdf'), false)
    assert.match(saved.get('second.pdf').toString('latin1'), /\/Subtype\s*\/Stamp/)
    console.log(
      'PASS: named signature is saved locally; placement targets active document and survives PDF save'
    )

    await new Promise((resolve) => {
      win.webContents.once('did-finish-load', resolve)
      win.reload()
    })
    await waitFor(count(1))
    await openLibrary()
    await editSignatureName('Temporary')
    await renameKey('Enter', true)
    assert.equal(await evaluate(`document.activeElement.matches('${renameInput}')`), true)
    await renameKey('Escape')
    await waitFor(`!document.querySelector('${renameInput}')`)
    assert.equal(await evaluate(`!!document.querySelector('[data-signature-options]')`), true)

    await editSignatureName('   ')
    await renameKey('Enter')
    await waitFor(`!document.querySelector('${renameInput}')`)
    assert.deepEqual(renames, [])
    assert.equal((await store.list())[0].name, 'signature 1')

    failRename = true
    await editSignatureName('Cannot save')
    await renameKey('Enter')
    await waitFor(
      `document.querySelector('[data-signature-options] [role="alert"]')?.textContent.includes('Test rename failure')`
    )
    assert.equal((await store.list())[0].name, 'signature 1')
    failRename = false

    await editSignatureName('  Personal  ')
    await renameKey('Enter')
    await waitFor(`!!document.querySelector('[aria-label="Use signature Personal"]')`)

    await editSignatureName('Signature 1')
    await evaluate(
      `document.querySelector('[data-signature-options] button[aria-label="Add signature"]').focus()`
    )
    await waitFor(`!!document.querySelector('[aria-label="Use signature Signature 1"]')`)
    assert.deepEqual(renames, ['Cannot save', 'Personal', 'Signature 1'])
    assert.equal(
      await evaluate(`document.activeElement.getAttribute('aria-label')`),
      'Add signature'
    )
    console.log(
      'PASS: inline rename saves once on Enter or blur, and handles Escape, IME, empty names and failed writes'
    )
    await evaluate(`window.testCommands.run('rotate-clockwise');window.testCommands.run('zoom-in')`)
    await openLibrary()
    await evaluate(`document.querySelector('[aria-label="Use signature Signature 1"]').click()`)
    await place(2)
    console.log(
      'PASS: the renamed signature survives reload and its preview matches placement after rotation and zoom'
    )

    await openLibrary()
    await evaluate(`document.querySelector('[aria-label="Use signature Signature 1"]').click()`)
    await waitFor(`!!document.querySelector('.signature-placement-hint')`)
    await evaluate(`document.querySelector('[aria-label="first.pdf"]').click()`)
    await waitFor(`!document.querySelector('.signature-placement-hint')`)
    assert.equal(await evaluate(count(0)), true)
    await evaluate(`document.querySelector('[aria-label="second.pdf"]').click()`)
    await waitFor(count(2))
    await openLibrary()
    await evaluate(`document.querySelector('[aria-label="Use signature Signature 1"]').click()`)
    await waitFor(`!!document.querySelector('.signature-placement-hint')`)
    await evaluate(`document.querySelector('[aria-label="Add text"]').click()`)
    await waitFor(`!document.querySelector('.signature-placement-hint')`)
    await evaluate(`document.querySelector('[aria-label="Selection tool"]').click()`)
    console.log('PASS: switching documents or tools cancels pending placement')

    await openLibrary()
    await button('Add signature', '[data-signature-options] button')
    const drawingHeight = `document.querySelector('[aria-label="Draw your signature"]')?.offsetHeight`
    await waitFor(`${drawingHeight} > 0`)
    const expectedDropZoneHeight = await evaluate(drawingHeight)
    await button('Import image', '[role="tablist"][aria-label="Signature source"] [role="tab"]')
    await waitFor(`document.querySelector('[aria-label="Signature image"]') !== null`)
    assert.equal(
      await evaluate(`document.querySelector('[data-signature-image-drop-zone]').offsetHeight`),
      expectedDropZoneHeight
    )
    await evaluate(`(async () => {
    const canvas=document.createElement('canvas');canvas.width=400;canvas.height=160;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,160);
    ctx.strokeStyle='black';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(60,110);ctx.lineTo(100,40);ctx.lineTo(140,100);ctx.lineTo(230,50);ctx.stroke();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'signature.png',{type:'image/png'}));
    const input=document.querySelector('[aria-label="Signature image"]');
    input.addEventListener('click', (event) => {
      event.preventDefault();
      input.files=transfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }, {once:true});
    document.querySelector('[data-signature-image-drop-zone]').dispatchEvent(new DragEvent('drop', {
      dataTransfer:transfer,bubbles:true,cancelable:true
    }));
  })()`)
    const readyPreview = `document.querySelector('[aria-label="Signature preview"][aria-busy="false"] img')`
    await waitFor(`!!${readyPreview}`)
    assert.equal(
      await evaluate(`document.querySelector('[data-signature-image-drop-zone]') === null`),
      true
    )
    const transparent = await evaluate(`(async () => {
    const image=document.querySelector('img[alt="Signature preview"]');await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    return {alpha:ctx.getImageData(0,0,1,1).data[3],width:canvas.width,height:canvas.height,ink:[...ctx.getImageData(0,0,canvas.width,canvas.height).data].filter((v,i)=>i%4===3&&v>0).length};
  })()`)
    assert.equal(transparent.alpha, 0)
    assert.ok(transparent.ink > 100)
    assert.ok(transparent.width < 300)
    const cropStart = await evaluate(`(() => {
      const handle = document.querySelector('[aria-label="Resize crop from top left"]').getBoundingClientRect();
      const image = document.querySelector('[aria-label="Original signature image"]').getBoundingClientRect();
      const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
      return { x: Math.round(x), y: Math.round(y), endX: Math.round(x + image.width * 0.32), endY: Math.round(y + image.height * 0.12) };
    })()`)
    const start = { x: cropStart.x, y: cropStart.y }
    const end = { x: cropStart.endX, y: cropStart.endY }
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...start })
    win.webContents.sendInputEvent({ type: 'mouseMove', ...end })
    const cropStyle = `document.querySelector('[data-signature-crop]').style`
    await waitFor(`parseFloat(${cropStyle}.left) > 25 && parseFloat(${cropStyle}.top) > 8`)
    await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const create = [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Create');
      const states = [];
      const observer = new MutationObserver(() => {
        if (dialog.querySelector('[aria-label="Signature preview"][aria-busy="true"]')) {
          states.push({ preview: !!dialog.querySelector('img[alt="Signature preview"]'), disabled: create.disabled });
        }
      });
      observer.observe(dialog, { childList: true, subtree: true, attributes: true });
      window.finishCropObservation = () => {
        observer.disconnect();
        delete window.finishCropObservation;
        return { states, ready: !create.disabled };
      };
    })()`)
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end })
    await waitFor(
      `document.querySelector('img[alt="Signature preview"]')?.naturalWidth > 0 && document.querySelector('img[alt="Signature preview"]').naturalWidth < ${transparent.width}`
    )
    const { states: cropUpdates, ready } = await evaluate('window.finishCropObservation()')
    assert.ok(cropUpdates.length > 0, 'The crop was observed while the preview was processing')
    assert.ok(
      cropUpdates.every(({ preview }) => preview),
      'The previous preview stays visible'
    )
    assert.ok(
      cropUpdates.every(({ disabled }) => disabled),
      'Create waits for the updated crop'
    )
    assert.equal(ready, true, 'Create is available after the preview updates')
    await button('Replace image', '[role="dialog"] button')
    await waitFor(
      `document.querySelector('[data-signature-crop]')?.style.left === '0%' && !!${readyPreview}`
    )
    assert.equal(
      await evaluate(`document.querySelector('[data-signature-image-drop-zone]') === null`),
      true
    )
    const backgroundCheckbox = `document.querySelector('[role="dialog"] [role="checkbox"][data-slot="checkbox"]')`
    assert.equal(await evaluate(`${backgroundCheckbox}.getAttribute('aria-checked')`), 'true')
    await evaluate(`${backgroundCheckbox}.closest('label').click()`)
    await waitFor(`${backgroundCheckbox}.getAttribute('aria-checked') === 'false'`)
    await waitFor(`!!${readyPreview}`)
    await button('Create')
    await place(3)
    assert.deepEqual(
      (await store.list()).map(({ name }) => name),
      ['Signature 1', 'signature 2']
    )
    console.log(
      'PASS: drag and drop and the image picker import signatures with crop and background removal before saving and placement'
    )

    await openLibrary()
    await signatureAction('Delete')
    await waitFor(
      `document.querySelector('[role="alertdialog"]')?.textContent.includes('Signature 1')`
    )
    await button('Keep', '[role="alertdialog"] button')
    await waitFor(`!document.querySelector('[role="alertdialog"]')`)
    assert.equal((await store.list()).length, 2)
    await signatureAction('Delete')
    await button('Delete', '[role="alertdialog"] button')
    await waitFor(`document.querySelectorAll('[aria-label^="Use signature " ]').length === 1`)
    await signatureAction('Delete')
    await button('Delete', '[role="alertdialog"] button')
    await waitFor(`document.querySelector('[aria-label="Draw your signature"]') !== null`)
    assert.equal((await store.list()).length, 0)
    await button('Cancel')
    assert.equal(await evaluate(count(3)), true)
    assert.deepEqual(errors, [])
    console.log(
      'PASS: deletion requires confirmation and leaves inserted copies untouched; no renderer errors'
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
