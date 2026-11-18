import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const { app, BrowserWindow, ipcMain, protocol } = electron
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lepis-pdf',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])
const root = path.resolve(import.meta.dirname, '..')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lepis-recovery-'))
app.setPath('userData', temp)
app.on('window-all-closed', () => {})
for (const name of ['pdf-sources', 'atomic-write', 'pdf-files', 'drafts']) {
  const source = await fs.readFile(path.join(root, 'src/main', `${name}.ts`), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  })
  await fs.writeFile(
    path.join(temp, `${name}.mjs`),
    outputText
      .replace("from './pdf-sources'", "from './pdf-sources.mjs'")
      .replace("from './atomic-write'", "from './atomic-write.mjs'")
      .replace("from './pdf-files'", "from './pdf-files.mjs'")
  )
}
const { createDraftStore } = await import(pathToFileURL(path.join(temp, 'drafts.mjs')).href)
const { readPdf, statPdf, savePdf, writePdfCopy } = await import(
  pathToFileURL(path.join(temp, 'pdf-files.mjs')).href
)
const { createPdfResponse, releasePdfSource } = await import(
  pathToFileURL(path.join(temp, 'pdf-sources.mjs')).href
)
let store = createDraftStore(temp)
const originalPath = path.join(temp, 'original.pdf')
const copyPath = path.join(temp, 'copy.pdf')
const original = await fs.readFile(path.join(root, 'tests/fixtures/two-pages.pdf'))
await fs.writeFile(originalPath, original)
let session = {
  tabs: [{ path: originalPath, page: 1, scale: 'page-fit', scrollTop: 0 }],
  activePath: originalPath,
  highlightColor: '#FDE047',
  highlightOpacity: 0.9,
  highlightThickness: 12,
  theme: 'light'
}
let holdDraft = false
let releaseDraft
let draftStarted = false
let failSave = false
ipcMain.handle('session:load', () => session)
ipcMain.handle('session:save', (_, value) => {
  session = value
})
ipcMain.handle('draft:load', () => store.load())
ipcMain.handle('draft:save', async (_, value) => {
  draftStarted = true
  if (holdDraft)
    await new Promise((resolve) => {
      releaseDraft = resolve
    })
  await store.save(value)
})
ipcMain.handle('draft:delete', (_, value) => store.remove(value))
ipcMain.handle('pdf:release-source', (_event, source) => releasePdfSource(source))
ipcMain.handle('pdf:read', (_, value) => readPdf(value))
ipcMain.handle('pdf:stat', (_, value) => statPdf(value))
ipcMain.handle('pdf:save', (_, value) => {
  if (failSave) throw new Error('Simulated save failure')
  return savePdf(value, temp)
})
ipcMain.handle('pdf:save-as', async (_, value) => {
  await writePdfCopy(copyPath, value.data)
  return copyPath
})
ipcMain.handle('pdf:close', () => {})
ipcMain.handle('pdf:open-dialog', () => [])
const preload = path.join(temp, 'preload.cjs')
await fs.writeFile(
  preload,
  `const { contextBridge, ipcRenderer } = require('electron');
const commands = new Map();
contextBridge.exposeInMainWorld('lepis', {
 releasePdfSource: source => ipcRenderer.invoke('pdf:release-source', source),
 loadDrafts: () => ipcRenderer.invoke('draft:load'), saveDraft: value => ipcRenderer.invoke('draft:save', value), deleteDraft: value => ipcRenderer.invoke('draft:delete', value),
 loadSession: () => ipcRenderer.invoke('session:load'), saveSession: value => ipcRenderer.invoke('session:save', value),
 readPdf: value => ipcRenderer.invoke('pdf:read', value), statPdf: value => ipcRenderer.invoke('pdf:stat', value),
 savePdf: value => ipcRenderer.invoke('pdf:save', value), savePdfAs: value => ipcRenderer.invoke('pdf:save-as', value),
 closePdf: value => ipcRenderer.invoke('pdf:close', value), openPdfDialog: () => ipcRenderer.invoke('pdf:open-dialog'),
 getPathForFile: () => '', setTheme: () => {}, confirmWindowClose: () => {}, onOpenRequested: () => () => {},
 onCommand: (name, callback) => { commands.set(name, callback); return () => commands.delete(name) }
});
contextBridge.exposeInMainWorld('testCommands', { run: name => commands.get(name)?.() });`
)
let win
const errors = []
const evaluate = (code) => win.webContents.executeJavaScript(code)
async function waitUntil(check, label = 'recovery workflow') {
  const deadline = Date.now() + 20000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
const waitFor = (code) => waitUntil(() => evaluate(code), code)
const button = (label) =>
  evaluate(
    `Array.from(document.querySelectorAll('[role=dialog] button')).find(button => button.textContent === ${JSON.stringify(label)})?.click()`
  )
const ready = () =>
  waitFor(
    `document.querySelector('[aria-label="Add text"]')?.disabled === false && !document.body.textContent.includes('Opening document')`
  )
async function launch() {
  win?.destroy() // Terminate the renderer without the normal save/close workflow.
  store = createDraftStore(temp)
  win = new BrowserWindow({
    show: false,
    width: 1180,
    height: 780,
    webPreferences: { backgroundThrottling: false, preload, sandbox: true, contextIsolation: true }
  })
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message)
  })
  await win.loadFile(path.join(root, 'out/renderer/index.html'))
  await enableTestFocus(win)
}
async function typeText(value) {
  await ready()
  await evaluate(
    `(() => { const button = document.querySelector('[aria-label="Add text"]'); if (button.getAttribute('aria-pressed') !== 'true') button.click(); })()`
  )
  await waitFor(
    `document.querySelector('.visible .annotationEditorLayer.freetextEditing') !== null`
  )
  await evaluate(
    `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
  )
  await evaluate(`(() => {
    const layer = document.querySelector('.visible .annotationEditorLayer');
    const rect = layer.getBoundingClientRect();
    const options = { bubbles:true, button:0, pointerId:1, clientX:rect.left+100, clientY:rect.top+100 };
    layer.dispatchEvent(new PointerEvent('pointerdown', options)); layer.dispatchEvent(new PointerEvent('pointerup', options));
  })()`)
  await waitFor(
    `document.querySelector('.visible .freeTextEditor.selectedEditor .internal')?.isContentEditable === true`
  )
  await evaluate(`(() => {
    const input = document.querySelector('.visible .freeTextEditor.selectedEditor .internal');
    input.focus(); input.innerText = ${JSON.stringify(value)};
    const selection = window.getSelection(); selection.setBaseAndExtent(input.firstChild, 4, input.firstChild, 4);
    input.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText'}));
  })()`)
}
async function draftContains(value) {
  const [draft] = await store.load()
  return draft && Buffer.from(draft.source.data).includes(Buffer.from(value))
}

app.whenReady().then(async () => {
  protocol.handle('lepis-pdf', createPdfResponse)

  try {
    await launch()
    await ready()
    await evaluate(`window.snapshotExports = 0;
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function(message, ...args) {
        if (message.action === 'SaveDocument') window.snapshotExports++;
        return post.call(this, message, ...args);
      }; void 0;`)
    await typeText('Recovered live text')
    await waitUntil(() => draftContains('Recovered live text'))
    const exports = await evaluate('window.snapshotExports')
    assert.ok(exports > 0, 'The counter must observe the initial PDF export')
    await new Promise((resolve) => setTimeout(resolve, 6500))
    assert.equal(
      await evaluate('window.snapshotExports'),
      exports,
      'Unchanged annotations must not export the PDF again'
    )
    assert.deepEqual(await fs.readFile(originalPath), original)
    assert.equal(await evaluate(`document.activeElement?.classList.contains('internal')`), true)
    assert.equal(await evaluate(`window.getSelection().anchorOffset`), 4)
    assert.equal(
      await evaluate(
        `document.querySelector('.document-tab[data-active="true"] > .size-2.rounded-full') !== null`
      ),
      true
    )
    console.log(
      'PASS: periodic recovery copy includes focused text, retains caret and dirty state, and preserves the original'
    )
    await evaluate(`(() => {
      const input = document.activeElement;
      input.innerText = 'Recovered live text updated';
      input.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText'}));
    })()`)
    await waitUntil(() => draftContains('Recovered live text updated'))
    console.log('PASS: edits made after the first snapshot update the existing recovery copy')
    await launch()
    await waitFor(`document.body.textContent.includes('Recover unsaved changes?')`)
    await button('Recover changes')
    await ready()
    assert.equal(
      await evaluate(
        `document.querySelector('.document-tab[data-active="true"] > .size-2.rounded-full') !== null`
      ),
      true
    )
    await evaluate(`window.testCommands.run('save')`)
    await waitUntil(async () => (await store.load()).length === 0)
    assert.match((await fs.readFile(originalPath)).toString('latin1'), /Recovered live text/)
    console.log(
      'PASS: renderer termination and relaunch offer recovery; saving persists annotations and removes the draft'
    )

    // A failed save must retain recovery data; subsequent edits must update the existing copy.
    await typeText('Second recovered text')
    await waitUntil(() => draftContains('Second recovered text'))
    failSave = true
    await evaluate(`window.testCommands.run('save')`)
    await waitFor(`document.body.textContent.includes('Simulated save failure')`)
    assert.equal((await store.load()).length, 1)
    failSave = false
    await launch()
    await waitFor(`document.body.textContent.includes('Recover unsaved changes?')`)
    await button('Discard recovery copies')
    await waitUntil(async () => (await store.load()).length === 0)
    assert.doesNotMatch(
      (await fs.readFile(originalPath)).toString('latin1'),
      /Second recovered text/
    )
    console.log(
      'PASS: failed save retains the draft; explicitly discarding recovery leaves the original intact'
    )

    await ready()
    await typeText('External conflict recovery')
    await waitUntil(() => draftContains('External conflict recovery'))
    await fs.writeFile(originalPath, original)
    const changedTime = new Date(Date.now() + 10000)
    await fs.utimes(originalPath, changedTime, changedTime)
    await launch()
    await waitFor(`document.body.textContent.includes('Recover unsaved changes?')`)
    await button('Recover changes')
    await ready()
    await evaluate(`window.testCommands.run('save')`)
    await waitFor(
      `document.body.textContent.includes('The original file is unavailable or changed')`
    )
    assert.deepEqual(await fs.readFile(originalPath), original)
    await button('Save as copy')
    await waitUntil(async () => (await store.load()).length === 0)
    assert.match((await fs.readFile(copyPath)).toString('latin1'), /External conflict recovery/)
    console.log(
      'PASS: changed originals are protected and recovered annotations can be saved as a copy'
    )

    await typeText('Missing original recovery')
    await waitUntil(() => draftContains('Missing original recovery'))
    await evaluate(`document.querySelector('[aria-label="Add text"]').click()`)
    await waitFor(
      `document.querySelector('[aria-label="Add text"]').getAttribute('aria-pressed') === 'false'`
    )
    await evaluate(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40;
      canvas.getContext('2d').fillRect(0, 0, 80, 40);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'test.png', {type:'image/png'}));
      window.dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer,bubbles:true,cancelable:true}));
    })()`)
    await waitFor(`document.querySelectorAll('.visible .stampEditor').length === 1`)
    await waitUntil(() => draftContains('/Stamp'))
    await fs.rm(copyPath)
    await launch()
    await waitFor(`document.body.textContent.includes('Recover unsaved changes?')`)
    await button('Recover changes')
    await ready()
    await evaluate(`window.testCommands.run('save')`)
    await waitFor(
      `document.body.textContent.includes('The original file is unavailable or changed')`
    )
    await button('Save as copy')
    await waitUntil(async () => (await store.load()).length === 0)
    assert.match((await fs.readFile(copyPath)).toString('latin1'), /Missing original recovery/)
    assert.match((await fs.readFile(copyPath)).toString('latin1'), /\/Subtype\s*\/Stamp/)
    console.log('PASS: a draft can be recovered and saved even when its original has disappeared')

    // Start another draft while a disk write is blocked; closing must drain it before removal.
    await typeText('Close without saving race')
    holdDraft = true
    draftStarted = false
    await waitUntil(() => draftStarted)
    await evaluate(`window.testCommands.run('close-tab')`)
    await button('Close without saving')
    holdDraft = false
    releaseDraft()
    await waitFor(`document.querySelectorAll('header .document-tab').length === 0`)
    assert.equal((await store.load()).length, 0)
    console.log('PASS: discard during an in-flight draft write cannot resurrect a recovery copy')
    assert.deepEqual(errors, [])
  } catch (error) {
    console.error(error)
    console.error(await evaluate('document.body.innerText').catch(() => 'Renderer unavailable'))
    process.exitCode = 1
  } finally {
    win?.destroy()
    try {
      await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 })
    } finally {
      app.exit(process.exitCode ?? 0)
    }
  }
})
