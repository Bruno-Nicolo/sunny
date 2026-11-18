import { chooseHighlightColor } from './fixtures/annotation-toolbar.mjs'
import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import { textPdf } from './fixtures/pdf.mjs'
const { app, BrowserWindow, ipcMain } = electron
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-highlight-'))
app.setPath('userData', temp)
// Exercise session restoration through the real loader, including absent tool preferences.
for (const name of ['shared/highlight', 'main/session', 'main/atomic-write']) {
  const source = fs.readFileSync(path.join(root, 'src', `${name}.ts`), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  })
  fs.writeFileSync(
    path.join(temp, `${path.basename(name)}.mjs`),
    outputText
      .replace("'../shared/highlight'", "'./highlight.mjs'")
      .replace("'./atomic-write'", "'./atomic-write.mjs'")
  )
}
const { loadSession } = await import(pathToFileURL(path.join(temp, 'session.mjs')).href)
const sessionPath = path.join(temp, 'session.json')
fs.writeFileSync(
  sessionPath,
  JSON.stringify({
    tabs: [{ path: 'second.pdf', page: 1, scale: 'page-fit', scrollTop: 0 }],
    activePath: 'second.pdf',
    theme: 'light'
  })
)
ipcMain.handle('test:session', () => loadSession(sessionPath))
const pdf = Buffer.from(textPdf)
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
  loadSession: () => ipcRenderer.invoke('test:session'),
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
  await chooseHighlightColor(evaluate, waitFor, next)
}

async function setHighlightRange(label, value) {
  await dragHighlightRange(label, [value])
}

async function dragHighlightRange(label, values) {
  const bounds = await evaluate(`(() => {
    const thumb = document.querySelector('[role="slider"][aria-label="${label}"]');
    const track = thumb.closest('[data-slot="slider"]').getBoundingClientRect();
    const handle = thumb.getBoundingClientRect();
    return {left: track.left, width: track.width, y: handle.top + handle.height / 2,
      x: handle.left + handle.width / 2,
      min: Number(thumb.getAttribute('aria-valuemin')), max: Number(thumb.getAttribute('aria-valuemax'))};
  })()`)
  win.webContents.sendInputEvent({
    type: 'mouseMove',
    x: Math.round(bounds.x),
    y: Math.round(bounds.y)
  })
  win.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    clickCount: 1
  })
  await evaluate(`new Promise(resolve => requestAnimationFrame(resolve))`)
  for (const value of values) {
    win.webContents.sendInputEvent({
      type: 'mouseMove',
      modifiers: ['leftButtonDown'],
      x: Math.round(
        bounds.left + (bounds.width * (value - bounds.min)) / (bounds.max - bounds.min)
      ),
      y: Math.round(bounds.y)
    })
    await waitFor(
      `document.querySelector('[role="slider"][aria-label="${label}"]').getAttribute('aria-valuenow') === '${value}'`
    )
  }
  win.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    x: Math.round(
      bounds.left + (bounds.width * (values.at(-1) - bounds.min)) / (bounds.max - bounds.min)
    ),
    y: Math.round(bounds.y),
    clickCount: 1
  })
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
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    await waitFor(
      `window.annotationErrors.length > 0 || document.querySelectorAll('[aria-label="Highlight color"] button').length === 8`
    )
    assert.deepEqual(
      await evaluate('window.annotationErrors'),
      [],
      'Opening the highlighter with absent session preferences must not crash ColorOptions'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Highlight color"] [aria-label="Yellow"]').getAttribute('aria-pressed')`
      ),
      'true'
    )
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    console.log(
      'PASS: highlighter opens with valid defaults when the saved session has no tool preferences'
    )
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
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    await evaluate(`(() => {
      const spans = [...document.querySelectorAll('.visible .textLayer span')];
      const first = spans.find(span => span.textContent === 'First highlight');
      const second = spans.find(span => span.textContent === 'Second highlight');
      const range = document.createRange();
      range.setStart(first.firstChild, 6);
      range.setEnd(second.firstChild, 6);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    })()`)
    await waitFor(`document.querySelector('.visible .highlightEditor.selectedEditor') !== null`)
    const multilineBorder = await evaluate(`(() => {
      const editor = document.querySelector('.visible .highlightEditor.selectedEditor');
      const path = editor.querySelector('.lepisHighlightContour path');
      const style = getComputedStyle(path);
      const reference = document.createElement('span');
      reference.style.color = 'var(--annotation-border-color)';
      editor.append(reference);
      const color = getComputedStyle(reference).color;
      reference.remove();
      return {
        outline: getComputedStyle(editor).outlineStyle,
        stroke: style.stroke,
        width: style.strokeWidth,
        color,
        segments: path.getAttribute('d').split('M').length - 1
      };
    })()`)
    assert.equal(multilineBorder.segments, 2, 'The selection must cover two separate lines')
    assert.equal(
      multilineBorder.outline,
      'none',
      'Multiline highlights must not have a bounding rectangle border'
    )
    assert.equal(multilineBorder.width, '1px')
    assert.notEqual(
      multilineBorder.stroke,
      'none',
      'The border must follow the highlighted line contours'
    )
    assert.notEqual(multilineBorder.stroke, 'transparent')
    assert.equal(multilineBorder.stroke, multilineBorder.color)
    await setHighlightRange('Opacity', 45)
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.visible .lepisHighlightDrawing path')).opacity`
      ),
      '0.45'
    )
    await evaluate(`void window.testCommands.run('undo')`)
    await waitFor(
      `getComputedStyle(document.querySelector('.visible .lepisHighlightDrawing path')).opacity === '0.9'`
    )
    console.log('PASS: opacity also updates text highlights and supports undo')
    await evaluate(`void window.testCommands.run('undo')`)
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === 0`)
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    console.log(
      'PASS: multiline highlight borders follow the individual lines without a bounding rectangle'
    )
    await chooseColor('Yellow', 'Pink')
    await setHighlightRange('Opacity', 90)
    await waitFor(
      `document.querySelector('[aria-label="Highlight text"]').getAttribute('aria-pressed') === 'true'`
    )
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
    console.log('PASS: highlight sidebar selects colors, toggles, and handles Escape')
    await chooseColor('Pink', 'Yellow')
    await waitFor(
      `document.querySelector('.visible .annotationEditorLayer.highlightEditing') !== null`
    )
    await waitFor(`document.querySelector('.visible .textLayer span') !== null`)
    await highlightText('First highlight', 1)
    await waitFor(`document.querySelector('.visible .highlightEditor.selectedEditor') !== null`)
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
    await waitFor(
      `document.querySelector('[aria-label="Highlight color"] [aria-label="Green"]').getAttribute('aria-pressed') === 'true'`
    )
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
      `document.querySelector('.visible .freeTextEditor .internal')?.isContentEditable === true`
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
    // Draw in a blank area with native pointer input, then reopen the saved PDF.
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    const before = await evaluate(`document.querySelectorAll('.visible .highlightEditor').length`)
    const blank = await evaluate(`(() => {
      const bounds = document.querySelector('.visible .lepisAnnotationLayer').getBoundingClientRect();
      return { x: Math.round(bounds.left + 100), y: Math.round(bounds.top + 330) };
    })()`)
    // Interrupted gestures must never become undo commands or saved annotations.
    for (const interruption of ['pointercancel', 'Escape', 'tool']) {
      await evaluate(`(() => {
        const target = document.elementFromPoint(${blank.x}, ${blank.y});
        target.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, pointerId: 41, button: 0, clientX: ${blank.x}, clientY: ${blank.y}
        }));
        window.dispatchEvent(new PointerEvent('pointermove', {
          pointerId: 41, clientX: ${blank.x + 40}, clientY: ${blank.y + 10}
        }));
      })()`)
      await waitFor(`document.querySelector('.lepisFreehandPreview') !== null`)
      assert.deepEqual(await evaluate('window.annotationErrors'), [])
      if (interruption === 'pointercancel') {
        await evaluate(`window.dispatchEvent(new PointerEvent('pointercancel', {pointerId: 41}))`)
      } else if (interruption === 'Escape') {
        pressKey('Escape')
      } else {
        await evaluate(`document.querySelector('[aria-label="Add text"]').click()`)
      }
      await waitFor(`!document.querySelector('.lepisFreehandPreview')`)
      await evaluate(`window.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 41, clientX: ${blank.x + 40}, clientY: ${blank.y + 10}
      }))`)
      assert.equal(
        await evaluate(`document.querySelectorAll('.visible .highlightEditor').length`),
        before
      )
      if (interruption !== 'pointercancel') {
        await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
      }
    }
    console.log('PASS: pointer cancellation, Escape and tool changes discard unfinished strokes')
    assert.equal(
      await evaluate(`document.querySelectorAll('[aria-label="Highlight color"] button').length`),
      8
    )
    await chooseHighlightColor(evaluate, waitFor, 'Purple')
    await setHighlightRange('Opacity', 45)
    await setHighlightRange('Stroke size', 24)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...blank })
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', ...blank, clickCount: 1 })
    for (let i = 1; i <= 10; i++) {
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: blank.x + i * 8,
        y: blank.y + Math.round(Math.sin(i / 2) * 20)
      })
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      x: blank.x + 80,
      y: blank.y - 19,
      clickCount: 1
    })
    await waitFor(`document.querySelectorAll('.visible .freehandHighlight').length === 1`)
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.visible .lepisHighlightDrawing .lepisFreehandStroke')).opacity`
      ),
      '0.45'
    )
    const strokeWidth = await evaluate(
      `parseFloat(getComputedStyle(document.querySelector('.visible .lepisFreehandStroke')).strokeWidth)`
    )
    assert.ok(strokeWidth > 0)
    await dragHighlightRange('Stroke size', [26, 28, 30, 32])
    assert.ok(
      Math.abs(
        (await evaluate(
          `parseFloat(getComputedStyle(document.querySelector('.visible .lepisFreehandStroke')).strokeWidth)`
        )) /
          strokeWidth -
          32 / 24
      ) < 0.001
    )
    await evaluate(`void window.testCommands.run('undo')`)
    await waitFor(
      `Math.abs(parseFloat(getComputedStyle(document.querySelector('.visible .lepisFreehandStroke')).strokeWidth) - ${strokeWidth}) < 0.001`
    )
    console.log('PASS: a continuous slider drag forms one undo command')
    await evaluate(`void window.testCommands.run('undo')`)
    await waitFor(`document.querySelectorAll('.visible .highlightEditor').length === ${before}`)
    await evaluate(`void window.testCommands.run('redo')`)
    await waitFor(`document.querySelectorAll('.visible .freehandHighlight').length === 1`)
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    const strokeBounds = () =>
      evaluate(`(() => {
      const { x, y } = document.querySelector('.visible .lepisHighlightDrawing .lepisFreehandStroke').getBBox();
      return { x, y };
    })()`)
    await evaluate(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )
    const original = await strokeBounds()
    const dragPoint = await evaluate(`(() => {
      const stroke=document.querySelector('.visible .lepisHighlightDrawing .lepisFreehandStroke')
      const point=stroke.getPointAtLength(stroke.getTotalLength()/2)
      const matrix=stroke.getScreenCTM()
      const screen=new DOMPoint(point.x,point.y).matrixTransform(matrix)
      return {x:Math.round(screen.x),y:Math.round(screen.y),dx:40/matrix.a,dy:32/matrix.d}
    })()`)
    const dragStart = { x: dragPoint.x, y: dragPoint.y }
    win.webContents.sendInputEvent({ type: 'mouseMove', ...dragStart })
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      ...dragStart,
      clickCount: 1
    })
    win.webContents.sendInputEvent({ type: 'mouseMove', x: dragStart.x + 40, y: dragStart.y + 32 })
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      x: dragStart.x + 40,
      y: dragStart.y + 32,
      clickCount: 1
    })
    await waitFor(async () => Math.abs((await strokeBounds()).x - original.x - dragPoint.dx) < 0.1)
    const moved = await strokeBounds()
    assert.ok(
      Math.abs(moved.y - original.y - dragPoint.dy) < 0.1,
      'Dragging must translate the stroke'
    )
    await evaluate(`void window.testCommands.run('save')`)
    await waitFor(() => saved.get('second.pdf')?.toString('latin1').includes('/InkList'))
    assert.deepEqual(await evaluate('window.annotationErrors'), [])
    await new Promise((resolve) => {
      win.webContents.once('did-finish-load', resolve)
      win.reload()
    })
    await waitFor(`document.querySelectorAll('.visible .freehandHighlight').length === 1`)
    const reopened = await strokeBounds()
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.visible .lepisFreehandStroke')).opacity`
      ),
      '0.45'
    )
    assert.ok(
      Math.abs(
        (await evaluate(
          `parseFloat(getComputedStyle(document.querySelector('.visible .lepisFreehandStroke')).strokeWidth)`
        )) - strokeWidth
      ) < 0.01
    )
    console.log(
      'PASS: custom highlight opacity and stroke size survive editing, undo and PDF reopening'
    )
    assert.ok(Math.abs(reopened.x - moved.x) < 0.1, 'Saved stroke must retain its moved x position')
    assert.ok(Math.abs(reopened.y - moved.y) < 0.1, 'Saved stroke must retain its moved y position')
    console.log('PASS: freehand highlights drag and retain their position after reopening')
    await evaluate(`(() => {
      window.annotationErrors = [];
      window.addEventListener('error', event => window.annotationErrors.push(event.message));
      window.addEventListener('unhandledrejection', event => window.annotationErrors.push(String(event.reason)));
    })()`)
    await evaluate(`document.querySelector('.visible .freehandHighlight').focus()`)
    pressKey('Delete')
    await waitFor(`document.querySelectorAll('.visible .freehandHighlight').length === 0`)
    await evaluate(`void window.testCommands.run('undo')`)
    await waitFor(`document.querySelectorAll('.visible .freehandHighlight').length === 1`)
    console.log(
      'PASS: freehand highlights draw on blank areas, undo, redo, save, reopen and delete'
    )
    await evaluate(`document.querySelector('[aria-label="Highlight text"]').click()`)
    const textBounds = await evaluate(`(() => {
      const rect = document.querySelector('.visible .textLayer span').getBoundingClientRect();
      return {x: Math.floor(rect.left), y: Math.floor(rect.top), width: Math.ceil(rect.width), height: Math.ceil(rect.height)};
    })()`)
    const darkPixels = async () => {
      const pixels = (await win.webContents.capturePage(textBounds)).toBitmap()
      let count = 0
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 60 && pixels[i + 1] < 60 && pixels[i + 2] < 60) count++
      return count
    }
    const beforeStroke = await darkPixels()
    assert.ok(beforeStroke > 20, 'The fixture must have dark text under the stroke')
    const start = { x: textBounds.x - 12, y: Math.round(textBounds.y + textBounds.height / 2) }
    win.webContents.sendInputEvent({ type: 'mouseMove', ...start })
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', ...start, clickCount: 1 })
    for (let i = 1; i <= 10; i++) {
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: start.x + Math.round(((textBounds.width + 24) * i) / 10),
        y: start.y
      })
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    await waitFor(`document.querySelector('.lepisFreehandPreview') !== null`)
    assert.ok(
      (await darkPixels()) >= beforeStroke * 0.95,
      'The live stroke must preserve dark text'
    )
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      x: start.x + textBounds.width + 24,
      y: start.y,
      clickCount: 1
    })
    await waitFor(`document.querySelectorAll('.visible .freehandHighlight').length === 2`)
    assert.ok(
      (await darkPixels()) >= beforeStroke * 0.95,
      'The completed stroke must preserve dark text'
    )
    console.log(
      'PASS: freehand preview and completed strokes preserve dark text with Multiply blending'
    )
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
