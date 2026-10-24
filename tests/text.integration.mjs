import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import { blankPdf } from './fixtures/pdf.mjs'
const { app, BrowserWindow, ipcMain } = electron
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-text-'))
app.setPath('userData', temp)
const pdf = Buffer.from(blankPdf)
const saved = new Map()
let saveCount = 0
ipcMain.handle('test:read', (_, name) => ({
  path: name,
  name,
  directoryName: 'test',
  source: { kind: 'memory', data: new Uint8Array(saved.get(name) ?? Buffer.from(pdf)).buffer },
  mtimeMs: 1,
  size: pdf.length
}))
ipcMain.handle('test:save', (_, payload) => {
  saved.set(payload.filePath, Buffer.from(payload.data))
  saveCount++
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
async function click(code) {
  win.webContents.focus()
  await waitFor(`document.hasFocus()`)
  // Popover entry animations must settle before computing native mouse coordinates.
  await new Promise((resolve) => setTimeout(resolve, 200))
  const { x, y } = await evaluate(`(() => {
    const target = (${code});
    if (!target) throw new Error('Missing click target: ' + ${JSON.stringify(code)});
    const rect = target.getBoundingClientRect();
    const point = {x:Math.round(rect.left + rect.width / 2), y:Math.round(rect.top + rect.height / 2)};
    if (!target.contains(document.elementFromPoint(point.x, point.y)))
      throw new Error('Click target is covered: ' + ${JSON.stringify(code)});
    return point;
  })()`)
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x, y, clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x, y, clickCount: 1 })
}
async function waitFor(code) {
  const check = typeof code === 'function' ? code : () => evaluate(code)
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > 15000) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
async function save() {
  const previous = saveCount
  await evaluate(`window.testCommands.run('save')`)
  await waitFor(() => saveCount > previous)
  await waitFor(`document.querySelector('.document-tab-active > .rounded-full') === null`)
}
async function addText() {
  await waitFor(
    `document.querySelector('.visible .annotationEditorLayer.freetextEditing') !== null`
  )
  await evaluate(`(() => {
    const layer = document.querySelector('.visible .annotationEditorLayer');
    const rect = layer.getBoundingClientRect();
    const options = {bubbles:true, button:0, pointerId:1, clientX:rect.left+100, clientY:rect.top+100};
    layer.dispatchEvent(new PointerEvent('pointerdown', options));
    layer.dispatchEvent(new PointerEvent('pointerup', options));
  })()`)
  await waitFor(
    `document.querySelector('.visible .freeTextEditor .internal[contenteditable="true"]') !== null`
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
    win.webContents.focus()
    await waitFor(`document.hasFocus()`)
    await waitFor(
      `document.querySelector('[aria-label="Add text"]')?.disabled === false && !document.body.textContent.includes('Opening document')`
    )
    await waitFor(
      `document.querySelector('header [aria-label="Text settings"]')?.disabled === false`
    )
    await click(`document.querySelector('header [aria-label="Text settings"]')`)
    await waitFor(`document.querySelector('[aria-label="Text size"]') !== null`)
    await click(
      `Array.from(document.querySelectorAll('[aria-label="Text size"] button')).find(button => button.textContent.trim() === '24 pt')`
    )
    await click(`document.querySelector('[aria-label="Text color"] [aria-label="Red"]')`)
    await waitFor(
      `document.querySelector('[aria-label="Text color"] [aria-label="Red"]')?.getAttribute('aria-pressed') === 'true'`
    )
    assert.equal(await evaluate(`document.querySelectorAll('.visible .freeTextEditor').length`), 0)
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="second.pdf"] > .rounded-full')`),
      null
    )
    await click(`document.querySelector('header [aria-label="Text settings"]')`)
    await waitFor(`document.querySelector('[aria-label="Text size"]') === null`)
    await addText()
    await waitFor(
      `getComputedStyle(document.querySelector('.visible .freeTextEditor .internal')).color === 'rgb(255, 0, 0)'`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.visible .freeTextEditor [aria-label="Text settings"]')`
      ),
      null
    )
    console.log(
      'PASS: toolbar defaults configure new text without dirtying the PDF or adding local controls'
    )
    await waitFor(`document.querySelector('header [aria-label="Text settings"]') !== null`)
    await evaluate(`document.querySelector('header [aria-label="Text settings"]').click()`)
    await waitFor(`document.querySelector('[aria-label="Text size"]') !== null`)
    assert.equal(
      await evaluate(`document.querySelector('[data-text-settings] input[type="color"]')`),
      null
    )
    await evaluate(
      `(() => { const button = Array.from(document.querySelectorAll('[aria-label="Text size"] button')).find(button => button.textContent.trim() === '24 pt'); button.focus(); button.click(); })()`
    )
    await waitFor(
      `document.querySelector('[aria-label="Text size"] button[aria-pressed="true"]')?.textContent.trim() === '24 pt'`
    )
    await evaluate(
      `(() => { const button = document.querySelector('[aria-label="Text color"] [aria-label="Red"]'); button.focus(); button.click(); })()`
    )
    await waitFor(
      `document.querySelector('[aria-label="Text color"] [aria-label="Red"]')?.getAttribute('aria-pressed') === 'true'`
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(await evaluate(`document.querySelectorAll('.visible .freeTextEditor').length`), 1)
    await evaluate(`document.querySelector('header [aria-label="Text settings"]').click()`)
    await waitFor(`document.querySelector('[aria-label="Text size"]') === null`)
    console.log('PASS: formatting opens from the toolbar and preserves the empty text box')
    await new Promise((resolve) => setTimeout(resolve, 100))
    await evaluate(`(() => {
      const text = document.querySelector('.visible .freeTextEditor .internal');
      text.focus();
      text.innerText = 'Testo aggiunto\\nSeconda riga con accenti: città, perché';
      text.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText'}));
    })()`)
    assert.equal(
      await evaluate(`document.querySelectorAll('.invisible .freeTextEditor').length`),
      0
    )
    console.log('PASS: click creates a multiline text editor only in the active tab')

    // Save while the caret is still in the text box: the pending content must be committed.
    await save()
    assert.equal(saved.has('first.pdf'), false)
    const output = saved.get('second.pdf').toString('latin1')
    assert.match(output, /\/Subtype\s*\/FreeText/)
    assert.match(output, /Testo aggiunto/)
    assert.match(output, /Seconda riga/)
    assert.match(output, /\/Helv 24 Tf/)
    assert.match(output, /1 0 0 rg/)
    console.log(
      'PASS: save commits focused text and embeds a FreeText annotation with the chosen size'
    )
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(`document.querySelectorAll('.visible .freeTextEditor').length === 0`)
    await evaluate(`window.testCommands.run('redo')`)
    await waitFor(`document.querySelectorAll('.visible .freeTextEditor').length === 1`)
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`
      ),
      true,
      'Undo/redo after saving must mark the document dirty'
    )
    console.log('PASS: text insertion supports undo and redo')
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    await waitFor(
      `document.querySelector('[aria-label="Add text"]').getAttribute('aria-pressed') === 'false'`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Highlight text"]').getAttribute('aria-pressed')`
      ),
      'true'
    )
    console.log('PASS: text and highlight tools are mutually exclusive')
    await new Promise((resolve) => {
      win.webContents.once('did-finish-load', resolve)
      win.reload()
    })
    await waitFor(
      `document.querySelector('[aria-label="Add text"]')?.disabled === false && !document.body.textContent.includes('Opening document')`
    )
    await evaluate(`document.querySelector('[aria-label="Add text"]').click()`)
    await waitFor(
      `document.querySelector('.visible .freeTextEditor .internal')?.innerText.replaceAll(String.fromCharCode(160), ' ').includes('Testo aggiunto')`
    )
    assert.match(
      await evaluate(
        `document.querySelector('.visible .freeTextEditor .internal').innerText.replaceAll(String.fromCharCode(160), ' ')`
      ),
      /città, perché/
    )
    win.webContents.focus()
    await waitFor(`document.hasFocus()`)
    await evaluate(`document.querySelector('.visible .freeTextEditor').focus()`)
    await waitFor(`document.querySelector('.visible .freeTextEditor.selectedEditor') !== null`)
    await waitFor(`document.querySelector('header [aria-label="Text settings"]') !== null`)
    await evaluate(`document.querySelector('header [aria-label="Text settings"]').click()`)
    await waitFor(
      `document.querySelector('[aria-label="Text size"] button[aria-pressed="true"]')?.textContent.trim() === '24 pt'`
    )
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(
      await evaluate(`document.querySelector('.visible .freeTextEditor .editToolbar')`),
      null,
      'Text annotations have no local toolbar'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Text color"] [aria-label="Red"]').getAttribute('aria-pressed')`
      ),
      'true'
    )
    await click(`document.querySelector('[aria-label="Text color"] [aria-label="Red"]')`)
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="second.pdf"] > .rounded-full') === null`
      ),
      true,
      'Choosing an imported annotation current color must not add an edit'
    )
    await click(`document.querySelector('[aria-label="Text color"] [aria-label="Blue"]')`)
    await waitFor(
      `getComputedStyle(document.querySelector('.visible .freeTextEditor .internal')).color === 'rgb(37, 99, 235)'`
    )
    await waitFor(
      `document.querySelector('[aria-label="Text color"] [aria-label="Blue"]')?.getAttribute('aria-pressed') === 'true'`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Text color"] [aria-label="Red"]').getAttribute('aria-pressed')`
      ),
      'false'
    )
    await click(
      `Array.from(document.querySelectorAll('[aria-label="Text size"] button')).find(button => button.textContent.trim() === '32 pt')`
    )
    await waitFor(
      `document.querySelector('[aria-label="Text size"] button[aria-pressed="true"]')?.textContent.trim() === '32 pt'`
    )
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(
      `document.querySelector('[aria-label="Text size"] button[aria-pressed="true"]')?.textContent.trim() === '24 pt'`
    )
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(
      `document.querySelector('[aria-label="Text color"] [aria-label="Red"]')?.getAttribute('aria-pressed') === 'true'`
    )
    console.log('PASS: real mouse clicks and undo keep the open formatting menu in sync')
    await evaluate(`document.querySelector('header [aria-label="Text settings"]').click()`)
    console.log('PASS: toolbar menu reflects the saved text formatting after reopening')
    await evaluate(
      `document.querySelector('.visible .freeTextEditor').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}))`
    )
    await waitFor(
      `document.querySelector('.visible .freeTextEditor .internal').contentEditable === 'true'`
    )
    await evaluate(`(() => {
      const text = document.querySelector('.visible .freeTextEditor .internal');
      text.innerText = 'Testo modificato';
      text.dispatchEvent(new InputEvent('input', {bubbles:true}));
    })()`)
    await click(`document.querySelector('header [aria-label="Text settings"]')`)
    await waitFor(`document.querySelector('[aria-label="Text color"]') !== null`)
    for (const color of ['Blue', 'Green', 'Red']) {
      await click(`document.querySelector('[aria-label="Text color"] [aria-label="${color}"]')`)
      await waitFor(
        `document.querySelector('[aria-label="Text color"] [aria-label="${color}"]')?.getAttribute('aria-pressed') === 'true'`
      )
      assert.equal(
        await evaluate(
          `document.querySelectorAll('[aria-label="Text color"] [aria-pressed="true"]').length`
        ),
        1
      )
      assert.equal(
        await evaluate(
          `document.querySelector('[aria-label="Text color"] [aria-label="${color}"][aria-pressed="true"]') !== null`
        ),
        true
      )
    }
    for (const size of [32, 16, 24]) {
      await click(
        `Array.from(document.querySelectorAll('[aria-label="Text size"] button')).find(button => button.textContent.trim() === '${size} pt')`
      )
      await waitFor(
        `document.querySelector('[aria-label="Text size"] button[aria-pressed="true"]')?.textContent.trim() === '${size} pt'`
      )
    }
    console.log('PASS: repeated changes update visible checkmarks while typing')
    await save()
    assert.match(saved.get('second.pdf').toString('latin1'), /Testo modificato/)
    if (
      await evaluate(
        `document.querySelector('[data-slot="popover-content"][data-state="open"] [aria-label="Text color"]') !== null`
      )
    )
      await evaluate(`document.querySelector('header [aria-label="Text settings"]').click()`)
    await waitFor(`document.querySelector('[aria-label="Text color"]') === null`)
    console.log(
      'PASS: saved text retains accented characters and can be edited and saved after reopening'
    )
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') === null`)
    await click(`document.querySelector('header [aria-label="Text settings"]')`)
    await waitFor(`document.querySelector('[aria-label="Text color"]') !== null`)
    await click(`document.querySelector('[aria-label="Text color"] [aria-label="Blue"]')`)
    await waitFor(
      `document.querySelector('[aria-label="Text color"] [aria-label="Blue"]')?.getAttribute('aria-pressed') === 'true'`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`
      ),
      true,
      'Changing only formatting after saving must mark the document dirty'
    )
    await save()
    assert.match(saved.get('second.pdf').toString('latin1'), /0\.15 0\.39 0\.92 rg/)
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(
      `document.querySelector('[aria-label="Text color"] [aria-label="Red"]')?.getAttribute('aria-pressed') === 'true'`
    )
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`)
    await save()
    assert.equal(
      [
        ...saved
          .get('second.pdf')
          .toString('latin1')
          .matchAll(/\/DA \(([^)]+)\)/g)
      ].at(-1)[1],
      '/Helv 24 Tf 1 0 0 rg'
    )
    console.log(
      'PASS: formatting and undo after saving remain dirty and persist on subsequent saves'
    )
    await click(`document.querySelector('[aria-label="Text color"] [aria-label="Red"]')`)
    await click(
      `Array.from(document.querySelectorAll('[aria-label="Text size"] button')).find(button => button.textContent.trim() === '24 pt')`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="second.pdf"] > .rounded-full') === null`
      ),
      true,
      'Choosing the current formatting must not dirty the document'
    )
    // Separate this size-only undo step from PDF.js's earlier grouped size commands.
    await click(`document.querySelector('[aria-label="Text color"] [aria-label="Gray"]')`)
    await click(`document.querySelector('[aria-label="Text color"] [aria-label="Red"]')`)
    await click(
      `Array.from(document.querySelectorAll('[aria-label="Text size"] button')).find(button => button.textContent.trim() === '32 pt')`
    )
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`)
    await save()
    assert.equal(
      [
        ...saved
          .get('second.pdf')
          .toString('latin1')
          .matchAll(/\/DA \(([^)]+)\)/g)
      ].at(-1)[1],
      '/Helv 32 Tf 1 0 0 rg'
    )
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(
      `document.querySelector('[aria-label="Text size"] button[aria-pressed="true"]')?.textContent.trim() === '24 pt'`
    )
    await save()
    console.log('PASS: size-only edits persist, while unchanged formatting adds no edits')

    await evaluate(`window.testCommands.run('tab-1')`)
    await waitFor(
      `document.querySelector('[aria-label="first.pdf"]').getAttribute('aria-pressed') === 'true'`
    )
    await waitFor(`document.querySelector('[aria-label="Text color"]') === null`)
    assert.equal(await evaluate(`document.querySelectorAll('.visible .freeTextEditor').length`), 0)
    await addText()
    await waitFor(`document.querySelector('header [aria-label="Text settings"]') !== null`)
    await click(`document.querySelector('header [aria-label="Text settings"]')`)
    await waitFor(
      `document.querySelector('[aria-label="Text size"] button[aria-pressed="true"]')?.textContent.trim() === '8 pt'`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Text color"] [aria-label="Black"]').getAttribute('aria-pressed')`
      ),
      'true'
    )
    await click(`document.querySelector('header [aria-label="Text settings"]')`)
    await waitFor(`document.querySelector('[aria-label="Text color"]') === null`)
    await evaluate(`document.querySelector('.visible .freeTextEditor .internal').focus()`)
    await waitFor(
      `document.activeElement === document.querySelector('.visible .freeTextEditor .internal')`
    )
    win.webContents.focus()
    await waitFor(`document.hasFocus()`)
    await win.webContents.insertText('   ')
    await waitFor(`document.querySelector('[aria-label="first.pdf"] > .rounded-full') !== null`)
    await save()
    await waitFor(`document.querySelector('.visible .freeTextEditor') === null`)
    assert.doesNotMatch(saved.get('first.pdf').toString('latin1'), /\/Subtype\s*\/FreeText/)
    console.log(
      'PASS: inactive tabs stay isolated, defaults are preserved, and whitespace-only text is removed on save'
    )

    await evaluate(`window.testCommands.run('tab-2')`)
    await waitFor(
      `document.querySelector('.visible .annotationEditorLayer:not(.disabled):not(.nonEditing) .freeTextEditor .internal')?.innerText.includes('Testo modificato')`
    )
    win.webContents.focus()
    await click(`document.querySelector('.visible .freeTextEditor')`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    await waitFor(`document.querySelector('.visible .freeTextEditor .internal').isContentEditable`)
    await evaluate(`(() => {
      const text = document.querySelector('.visible .freeTextEditor .internal');
      text.focus();
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    })()`)
    await waitFor(
      `document.hasFocus() && document.activeElement === document.querySelector('.visible .freeTextEditor .internal')`
    )
    await win.webContents.insertText('Testo da tastiera: più righe')
    await waitFor(
      `document.querySelector('.visible .freeTextEditor .internal').innerText.includes('Testo da tastiera')`
    )
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`)
    await save()
    assert.match(saved.get('second.pdf').toString('latin1'), /Testo da tastiera/)
    console.log('PASS: real keyboard input after switching tabs is saved')
    await evaluate(`(() => {
      window.zoomTextInput = document.querySelector('.visible .freeTextEditor .internal');
      window.zoomTextAnchor = window.getSelection().anchorNode;
      window.zoomTextOffset = window.getSelection().anchorOffset;
      window.zoomPageCanvas = document.querySelector('.visible .canvasWrapper canvas');
      window.testCommands.run('zoom-in');
    })()`)
    await waitFor(
      `document.querySelector('.visible .canvasWrapper canvas') !== window.zoomPageCanvas`
    )
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.visible .freeTextEditor .internal') === window.zoomTextInput`
      ),
      true
    )
    assert.equal(
      await evaluate(`document.activeElement === window.zoomTextInput`),
      true,
      'Page redraw must preserve the focused annotation input'
    )
    assert.equal(
      await evaluate(
        `window.getSelection().anchorNode === window.zoomTextAnchor && window.getSelection().anchorOffset === window.zoomTextOffset`
      ),
      true,
      'Page redraw must preserve the text caret'
    )
    console.log('PASS: zoom preserves annotation DOM, focus and caret')

    const previousPdf = saved.get('second.pdf').toString('latin1')
    const previousLeft = await evaluate(
      `document.querySelector('.visible .freeTextEditor').style.left`
    )
    await evaluate(`(() => {
      const editor = document.querySelector('.visible .freeTextEditor');
      editor.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, pointerId:1, clientX:100, clientY:100}));
      window.dispatchEvent(new PointerEvent('pointermove', {pointerId:1, clientX:120, clientY:110}));
      window.dispatchEvent(new PointerEvent('pointerup', {button:0, pointerId:1}));
    })()`)
    assert.notEqual(
      await evaluate(`document.querySelector('.visible .freeTextEditor').style.left`),
      previousLeft
    )
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > .rounded-full') !== null`)
    await save()
    assert.notEqual(saved.get('second.pdf').toString('latin1'), previousPdf)
    await evaluate(`window.testCommands.run('undo')`)
    await waitFor(
      `document.querySelector('.visible .freeTextEditor').style.left === ${JSON.stringify(previousLeft)}`
    )
    console.log('PASS: moving saved text marks it dirty and can be saved')
  })
  .then(() => finish(0))
  .catch((error) => {
    console.error(error)
    finish(1)
  })
function finish(code) {
  win?.destroy()
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  app.exit(code)
}
