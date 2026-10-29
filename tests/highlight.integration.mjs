import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import { textPdf } from './fixtures/pdf.mjs'
const { app, BrowserWindow, ipcMain } = electron
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-highlight-'))
app.setPath('userData', temp)
const pdf = Buffer.from(textPdf)
const saved = new Map()
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
const evaluate = (code) =>
  win.webContents.executeJavaScript(code).catch((error) => {
    error.message += `\n${code}`
    throw error
  })
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
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="Text selection actions"]')`),
    null,
    'An active annotation tool must suppress the selection popover'
  )
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
    await evaluate(`(() => {
      window.annotationErrors = [];
      window.addEventListener('error', event => window.annotationErrors.push(event.message));
      window.addEventListener('unhandledrejection', event => window.annotationErrors.push(String(event.reason)));
    })()`)
    await waitFor(
      `document.querySelector('[aria-label="Highlight text"]')?.disabled === false && !document.body.textContent.includes('Opening document')`
    )
    await waitFor(`document.querySelector('.visible .textLayer span') !== null`)
    const selectWithoutTool = () =>
      evaluate(`(() => {
      const span = document.querySelector('.visible .textLayer span');
      span.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      const range = document.createRange(); range.selectNodeContents(span);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    })()`)
    await selectWithoutTool()
    await waitFor(`document.querySelector('[aria-label="Text selection actions"]') !== null`)
    assert.ok(await evaluate(`window.getSelection().toString().length > 0`))
    await waitFor(`(() => {
      const popover = document.querySelector('[aria-label="Text selection actions"]').getBoundingClientRect();
      const selection = window.getSelection().getRangeAt(0).getClientRects()[0];
      return Math.abs(popover.right - selection.right) < 2 && popover.bottom < selection.top;
    })()`)

    pressKey('Escape')
    await waitFor(`!document.querySelector('[aria-label="Text selection actions"]')`)
    await selectWithoutTool()
    await waitFor(`document.querySelector('[aria-label="Text selection actions"]') !== null`)
    await evaluate(`document.querySelector('[aria-label="Text selection actions"] button').click()`)
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === 1`)
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Highlight text"]').getAttribute('aria-pressed')`
      ),
      'false'
    )
    await evaluate(`void window.testCommands.run('undo')`)
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === 0`)
    console.log(
      'PASS: selection popover preserves text, dismisses with Escape and highlights without activating a tool'
    )
    await chooseColor('Yellow', 'Pink')
    await waitFor(
      `document.querySelector('[aria-label="Highlight text"]').getAttribute('aria-pressed') === 'true' && document.querySelector('[aria-label="Highlight color: Pink"]') !== null && !document.querySelector('[aria-label="Pink"]')`
    )
    await evaluate(`document.querySelector('[aria-label="Highlight color: Pink"]').click()`)
    await waitFor(`document.querySelector('[aria-label="Yellow"]') !== null`)
    pressKey('Escape')
    await waitFor(`!document.querySelector('[aria-label="Yellow"]')`)
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Highlight text"]').getAttribute('aria-pressed')`
      ),
      'false',
      'Escape in the palette must close it and deactivate the tool'
    )
    pressKey('h')
    await waitFor(
      `document.querySelector('[aria-label="Highlight text"]').getAttribute('aria-pressed') === 'true'`
    )
    pressKey('Escape')
    await waitFor(
      `document.querySelector('[aria-label="Highlight text"]').getAttribute('aria-pressed') === 'false'`
    )
    pressKey('t')
    await waitFor(
      `document.querySelector('[aria-label="Add text"]').getAttribute('aria-pressed') === 'true'`
    )
    await evaluate(`(() => {
      const input = document.createElement('textarea');
      input.id = 'shortcut-input';
      document.body.append(input);
      input.focus();
    })()`)
    pressKey('h')
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Add text"]').getAttribute('aria-pressed')`
      ),
      'true',
      'Typing in a field must not switch tools'
    )
    pressKey('Escape')
    await waitFor(
      `document.querySelector('[aria-label="Add text"]').getAttribute('aria-pressed') === 'false'`
    )
    await evaluate(`document.querySelector('#shortcut-input').remove()`)
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    await waitFor(
      `document.querySelector('[aria-label="Highlight text"]').getAttribute('aria-pressed') === 'true'`
    )
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    await waitFor(
      `document.querySelector('[aria-label="Highlight text"]').getAttribute('aria-pressed') === 'false'`
    )
    console.log('PASS: split highlight control selects colors, toggles, and handles Escape')
    await chooseColor('Pink', 'Yellow')
    await waitFor(
      `document.querySelector('.visible .annotationEditorLayer.highlightEditing') !== null`
    )
    await waitFor(`document.querySelector('.visible .textLayer span') !== null`)
    await highlightText('First highlight', 1)
    await waitFor(`document.querySelector('.visible .highlightEditor.selectedEditor') !== null`)
    await evaluate(`document.querySelector('[aria-label="Highlight color: Yellow"]').click()`)
    await waitFor(`document.querySelector('[aria-label="Green"]') !== null`)
    assert.equal(
      await evaluate(`document.querySelector('.visible .highlightEditor.selectedEditor') !== null`),
      true
    )
    await evaluate(`document.querySelector('[aria-label="Green"]').click()`)
    assert.deepEqual(
      await evaluate('window.annotationErrors'),
      [],
      'Creating and recoloring a highlight must not throw or interrupt annotation editing'
    )
    await waitFor(`document.querySelector('[aria-label="Highlight color: Green"]') !== null`)
    assert.equal(
      await evaluate(`document.querySelector('.visible .highlightEditor .editToolbar')`),
      null,
      'Highlight annotations have no local toolbar'
    )
    await highlightText('Second highlight', 2)
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(() => saved.has('second.pdf'))
    const colors = [
      ...saved
        .get('second.pdf')
        .toString('latin1')
        .matchAll(/\/C\s*\[([^\]]+)\]/g)
    ].map((match) => match[1].trim().split(/\s+/).map(Number))
    assert.equal(colors.length, 2, 'Both highlights must be saved')
    for (const color of colors) {
      assert.ok(
        color.every(
          (value, index) => Math.abs(value - [134 / 255, 239 / 255, 172 / 255][index]) < 0.001
        ),
        `Selected and new highlights must both be green, got ${color}`
      )
    }
    console.log('PASS: recoloring yellow to green also sets green for the next highlight')
    await evaluate(`document.querySelector('.visible .highlightEditor.selectedEditor').focus()`)
    await waitFor(`document.hasFocus() && document.activeElement.matches('.highlightEditor')`)
    pressKey('Backspace')
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === 1`)
    await evaluate(`void window.testCommands.run('undo')`)
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === 2`)
    await evaluate(`document.querySelector('.visible .highlightEditor.selectedEditor').focus()`)
    pressKey('Delete')
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === 1`)
    console.log('PASS: highlights have no local toolbar and support Backspace, Delete, and undo')
    await evaluate(`document.querySelector('[aria-label="Add text"]').click()`)
    await waitFor(
      `document.querySelector('.visible .annotationEditorLayer.freetextEditing') !== null`
    )
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    const point = await evaluate(`(() => {
      const rect = document.querySelector('.visible .annotationEditorLayer').getBoundingClientRect();
      return {x: Math.round(rect.left + 100), y: Math.round(rect.top + 200)};
    })()`)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', ...point, clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', ...point, clickCount: 1 })
    await waitFor(
      `document.querySelector('.visible .freeTextEditor .internal[contenteditable="true"]') !== null`
    )
    await evaluate(`(() => {
      const text = document.querySelector('.visible .freeTextEditor .internal');
      text.innerText = 'Text after recoloring a highlight';
      text.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText'}));
    })()`)
    await waitFor(`document.querySelector('[aria-label="second.pdf"] > span.size-2') !== null`)
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(() =>
      saved.get('second.pdf')?.toString('latin1').includes('Text after recoloring a highlight')
    )
    assert.match(saved.get('second.pdf').toString('latin1'), /Text after recoloring a highlight/)
    assert.deepEqual(await evaluate('window.annotationErrors'), [])
    console.log(
      'PASS: text can be created and saved after recoloring a highlight without renderer errors'
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
