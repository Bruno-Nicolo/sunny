import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { blankPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-documents-'))
app.setPath('userData', temp)
const sessionResolvers = []
let saveMode = 'success'
let copyCanceled = false
let closeFailed = false
let sessionFailed = false
let sessionHeld = false
const sessionSaveResolvers = []
let confirmations = 0
const persistedSessions = []
let blockedClosePath = null
let resolveClose = null
const closed = []
const files = new Map(
  ['two-pages.pdf', 'password.pdf'].map((name) => [
    name,
    new Uint8Array(fs.readFileSync(path.join(root, 'tests/fixtures', name)))
  ])
)
const mtimes = new Map()
const reads = new Map()
const rendererErrors = []
const document = (name) => ({
  path: name,
  name,
  directoryName: 'test',
  data: new Uint8Array(files.get(name) ?? blankPdf).buffer,
  mtimeMs: mtimes.get(name) ?? 1,
  size: blankPdf.length
})
ipcMain.handle('test:session', () => new Promise((resolve) => sessionResolvers.push(resolve)))
ipcMain.handle('test:read', (_, name) => {
  reads.set(name, (reads.get(name) ?? 0) + 1)
  if (name === 'missing.pdf') throw new Error('Missing document')
  return document(name)
})
ipcMain.handle('test:stat', (_, name) => ({
  mtimeMs: mtimes.get(name) ?? 1,
  size: blankPdf.length
}))
ipcMain.handle('test:save', (_, payload) => {
  if (saveMode === 'failure') throw new Error('Save failed')
  if (saveMode === 'conflict') throw new Error('FILE_CHANGED_EXTERNALLY')
  files.set(payload.filePath, payload.data)
  return { mtimeMs: 1, size: payload.data.length }
})
ipcMain.handle('test:copy', (_, payload) => {
  if (copyCanceled) return null
  files.set('copy.pdf', payload.data)
  return document('copy.pdf')
})
ipcMain.handle('test:close', (_, id) => {
  if (closeFailed) throw new Error('Close failed')
  closed.push(id)
  if (blockedClosePath)
    return new Promise((resolve) => {
      resolveClose = resolve
    })
})

ipcMain.handle('test:persist', async (_, session) => {
  if (sessionFailed) throw new Error('Session save failed')
  if (sessionHeld)
    await new Promise((resolve) => {
      sessionSaveResolvers.push(resolve)
    })
  persistedSessions.push(session)
})
ipcMain.on('test:confirm', () => {
  confirmations++
})

const preload = path.join(temp, 'preload.cjs')
fs.writeFileSync(
  preload,
  `const { contextBridge, ipcRenderer } = require('electron')
const commands = new Map()
const openListeners = new Set()
contextBridge.exposeInMainWorld('lepis', {
  setTheme: () => {},
  loadSession: () => ipcRenderer.invoke('test:session'),
  readPdf: path => ipcRenderer.invoke('test:read', path),
  savePdf: payload => ipcRenderer.invoke('test:save', payload),
  savePdfAs: payload => ipcRenderer.invoke('test:copy', payload),
  closePdf: id => ipcRenderer.invoke('test:close', id),
  statPdf: path => ipcRenderer.invoke('test:stat', path), saveSession: state => ipcRenderer.invoke('test:persist', state),
  openPdfDialog: async () => [], getPathForFile: file => file.name,
  confirmWindowClose: () => ipcRenderer.send('test:confirm'),
  onOpenRequested: callback => { openListeners.add(callback); return () => openListeners.delete(callback) },
  onCommand: (name, callback) => { commands.set(name,callback); return () => commands.delete(name) }
})
contextBridge.exposeInMainWorld('testCommands', {
  run: name => commands.get(name)?.(),
  open: path => openListeners.forEach(callback => callback(path)),
  listening: () => openListeners.size > 0
})`
)

let win
const evaluate = (code) => win.webContents.executeJavaScript(code)
async function waitUntil(check) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > 15000) throw new Error('Timed out waiting for document workflow')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
const waitFor = (code) => waitUntil(() => evaluate(code))
const hasTab = (name) => `document.querySelector('header button[title="${name}"]') !== null`
const activeTab = (name) =>
  `document.querySelector('header button[title="${name}"]')?.className.includes('bg-background text-foreground')`
const clickButton = (label) =>
  evaluate(
    `Array.from(document.querySelectorAll('[role="dialog"][data-state="open"] button')).find(button => button.textContent === '${label}')?.click()`
  )
const addImage = () =>
  evaluate(`(async () => {
  const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40;
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'test.png', {type:'image/png'}));
  const input = document.querySelector('[aria-label="Choose images"]');
  input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
})()`)

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
      if (details.level === 'error') rendererErrors.push(details.message)
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await waitFor('window.testCommands.listening()')
    await evaluate("window.testCommands.open('startup.pdf')")
    await waitFor(hasTab('startup.pdf'))
    await waitUntil(() => sessionResolvers.length > 0)
    for (const resolve of sessionResolvers)
      resolve({
        tabs: ['restored.pdf', 'missing.pdf', 'startup.pdf'].map((path) => ({
          path,
          page: 1,
          scale: 'page-fit',
          scrollTop: 0
        })),
        activePath: 'restored.pdf',
        highlightColor: '#FDE047',
        theme: 'light'
      })
    await waitFor(hasTab('restored.pdf'))
    assert.equal(await evaluate(activeTab('startup.pdf')), true)
    assert.equal(await evaluate('document.querySelectorAll("header button[title]").length'), 2)
    console.log(
      'PASS: delayed restore preserves startup documents and selection without duplicates'
    )

    const tabOrder = () =>
      evaluate(
        'Array.from(document.querySelectorAll("header button[title]")).map(tab => tab.title)'
      )
    const dragTab = async (name, target) => {
      const points = await evaluate(`(() => {
        const center = name => {
          const rect = document.querySelector('header button[title="' + name + '"]').getBoundingClientRect();
          return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)};
        };
        return [center(${JSON.stringify(name)}), center(${JSON.stringify(target)})];
      })()`)
      const [start, end] = points
      win.webContents.sendInputEvent({ type: 'mouseMove', ...start })
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...start })
      for (let step = 1; step <= 12; step++) {
        win.webContents.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(start.x + ((end.x - start.x) * step) / 12),
          y: start.y
        })
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end })
    }
    await dragTab('startup.pdf', 'restored.pdf')
    await waitUntil(async () => (await tabOrder())[0] === 'startup.pdf')
    await waitUntil(() => persistedSessions.at(-1)?.tabs[0]?.path === 'startup.pdf')
    assert.equal(await evaluate(activeTab('startup.pdf')), true)
    await dragTab('startup.pdf', 'restored.pdf')
    await waitUntil(() => persistedSessions.at(-1)?.tabs[0]?.path === 'restored.pdf')
    assert.deepEqual(await tabOrder(), ['restored.pdf', 'startup.pdf'])
    console.log('PASS: dragging tabs in both directions preserves selection and persists the order')

    blockedClosePath = 'startup.pdf'
    await evaluate("window.testCommands.run('close-tab')")
    await waitUntil(() => resolveClose !== null)
    await evaluate("window.testCommands.open('new.pdf')")
    await waitFor(hasTab('new.pdf'))
    blockedClosePath = null
    resolveClose()
    await waitFor(`!(${hasTab('startup.pdf')})`)
    assert.equal(await evaluate(hasTab('restored.pdf')), true)
    assert.equal(await evaluate(activeTab('new.pdf')), true)
    console.log('PASS: delayed close preserves newly opened documents and selection')

    await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['pdf'], 'missing.pdf', {type:'application/pdf'}));
    transfer.items.add(new File(['pdf'], 'available.pdf', {type:'application/pdf'}));
    document.querySelector('main').dispatchEvent(new DragEvent('drop', {dataTransfer:transfer,bubbles:true,cancelable:true}));
  })()`)
    await waitFor(hasTab('available.pdf'))
    assert.equal(await evaluate(hasTab('missing.pdf')), false)
    await waitFor("document.body.textContent.includes('Missing document')")
    console.log('PASS: one failed dropped document does not discard successful openings')

    await waitFor('document.querySelector(\'[aria-label="Add image"]\')?.disabled === false')
    await addImage()
    await waitFor(
      'document.querySelector(\'header button[title="available.pdf"] .bg-foreground\') !== null'
    )
    saveMode = 'failure'
    const closeCount = closed.length
    await evaluate("window.testCommands.run('close-tab')")
    await waitFor("document.body.textContent.includes('Save changes before closing?')")
    const annotationsBeforeDialogKeys = await evaluate(
      "document.querySelectorAll('.visible .stampEditor canvas').length"
    )
    assert.equal(annotationsBeforeDialogKeys, 1)
    await evaluate(`(() => {
      const target = document.querySelector('[role=dialog][data-state=open] button');
      target.dispatchEvent(new KeyboardEvent('keydown', {key:'z', code:'KeyZ', metaKey:true, bubbles:true, cancelable:true}));
      target.dispatchEvent(new KeyboardEvent('keydown', {key:'Backspace', code:'Backspace', bubbles:true, cancelable:true}));
    })()`)
    assert.equal(
      await evaluate("document.querySelectorAll('.visible .stampEditor canvas').length"),
      annotationsBeforeDialogKeys
    )
    await clickButton('Save and close')
    await waitFor("document.body.textContent.includes('Save failed')")
    assert.equal(await evaluate(hasTab('available.pdf')), true)
    assert.equal(closed.length, closeCount)
    console.log('PASS: failed save leaves the dirty document open and pending closure')

    saveMode = 'conflict'
    await clickButton('Save and close')
    await waitFor("document.body.textContent.includes('The file changed on disk')")
    assert.equal(
      await evaluate('document.querySelectorAll("[role=dialog][data-state=open]").length'),
      1
    )
    await clickButton('Cancel')
    await waitFor("document.body.textContent.includes('Save changes before closing?')")
    assert.equal(await evaluate(hasTab('available.pdf')), true)
    console.log('PASS: canceling a save conflict returns to the pending close request')

    await clickButton('Save and close')
    await waitFor("document.body.textContent.includes('The file changed on disk')")
    copyCanceled = true
    await clickButton('Save as copy')
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(await evaluate(hasTab('available.pdf')), true)
    assert.equal(closed.length, closeCount)
    copyCanceled = false
    await clickButton('Save as copy')
    await waitFor(hasTab('copy.pdf'))
    await waitFor("document.body.textContent.includes('Save changes before closing?')")
    saveMode = 'success'
    closeFailed = true
    await clickButton('Save and close')
    await waitFor("document.body.textContent.includes('Close failed')")
    assert.equal(await evaluate(hasTab('copy.pdf')), true)
    assert.equal(
      await evaluate('document.querySelectorAll("[role=dialog][data-state=open]").length'),
      1
    )
    closeFailed = false
    await clickButton('Save and close')
    await waitFor(`!(${hasTab('copy.pdf')})`)
    assert.equal(await evaluate(hasTab('new.pdf')), true)
    assert.equal(await evaluate(hasTab('restored.pdf')), true)
    console.log('PASS: canceled copy keeps edits, successful copy resolves the pending close')

    await waitFor('document.querySelector(\'[aria-label="Add image"]\')?.disabled === false')
    await addImage()
    await waitFor(
      `document.querySelector('header button[title="new.pdf"] .bg-foreground') !== null`
    )
    await evaluate("window.testCommands.run('close-tab')")
    await waitFor(
      "document.querySelector('[role=dialog][data-state=open]')?.textContent.includes('Save changes before closing?')"
    )
    await clickButton('Save and close')
    await waitFor(`!(${hasTab('new.pdf')})`)
    assert.equal(
      await evaluate('document.querySelectorAll("[role=dialog][data-state=open]").length'),
      0
    )
    await evaluate("window.testCommands.open('new.pdf')")
    await waitFor(activeTab('new.pdf'))
    console.log('PASS: saving a dirty tab closes it on the first confirmation')

    await evaluate("window.testCommands.open('two-pages.pdf')")
    await waitFor(
      "document.querySelectorAll('.visible .pdfViewer .page').length === 2 && !document.body.textContent.includes('Opening document')"
    )
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    await evaluate("window.testCommands.run('zoom-in')")
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    await evaluate("window.testCommands.run('next-page')")
    await waitFor("document.querySelector('[aria-label=\"Current page\"]').value === '2'")
    await waitFor("document.querySelector('.visible .pdf-viewer-container').scrollTop > 0")
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
    const zoom = await evaluate(
      "Array.from(document.querySelectorAll('header button')).find(button => button.textContent.endsWith('%'))?.textContent"
    )
    mtimes.set('two-pages.pdf', 10)
    await evaluate("window.dispatchEvent(new Event('focus'))")
    await waitUntil(() => reads.get('two-pages.pdf') >= 2)
    await waitFor(
      "document.querySelector('.visible .page[data-page-number=\"2\"] canvas') !== null && !document.body.textContent.includes('Opening document')"
    )
    assert.equal(
      await evaluate('document.querySelector(\'[aria-label="Current page"]\').value'),
      '2'
    )
    assert.equal(
      await evaluate(
        "Array.from(document.querySelectorAll('header button')).find(button => button.textContent.endsWith('%'))?.textContent"
      ),
      zoom
    )
    console.log(
      'PASS: reloading preserves the latest page and zoom rather than the initial position'
    )

    await evaluate("window.testCommands.open('password.pdf')")
    await waitFor('document.querySelector(\'[aria-label="PDF password"]\') !== null')
    await evaluate("window.testCommands.run('previous-tab')")
    await waitFor('document.querySelectorAll("[role=dialog][data-state=open]").length === 0')
    await evaluate("window.testCommands.run('next-tab')")
    await waitFor('document.querySelectorAll("[role=dialog][data-state=open]").length === 1')
    const enterPassword = async (password) => {
      await evaluate(`(() => {
        const input = document.querySelector('[aria-label="PDF password"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(password)});
        input.dispatchEvent(new Event('input', {bubbles:true}));
      })()`)
      await clickButton('Open')
    }
    await enterPassword('wrong-password')
    await waitFor("document.body.textContent.includes('The password was incorrect. Try again.')")
    await enterPassword('lepis-test')
    await waitFor(
      "document.querySelectorAll('[role=dialog][data-state=open]').length === 0 && document.querySelector('[aria-label=\"Add image\"]')?.disabled === false && !document.body.textContent.includes('Opening document')"
    )
    await evaluate("window.testCommands.run('close-tab')")
    await waitFor(`!(${hasTab('password.pdf')})`)
    await addImage()
    await waitFor(
      `document.querySelector('header button[title="two-pages.pdf"] .bg-foreground') !== null`
    )
    const readsBeforeConflict = reads.get('two-pages.pdf')
    mtimes.set('two-pages.pdf', 20)
    await evaluate(
      "window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus'))"
    )
    await waitFor(
      "document.querySelector('[role=dialog][data-state=open]')?.textContent.includes('The file changed on disk')"
    )
    assert.equal(reads.get('two-pages.pdf'), readsBeforeConflict)
    await clickButton('Cancel')
    assert.equal(
      await evaluate(
        `document.querySelector('header button[title="two-pages.pdf"] .bg-foreground') !== null`
      ),
      true
    )
    console.log(
      'PASS: external changes to dirty files prompt without reloading or dropping annotations'
    )

    await evaluate("window.testCommands.run('window-close-requested')")
    await waitFor(
      "document.querySelector('[role=dialog][data-state=open]')?.textContent.includes('Save changes before closing?')"
    )
    await clickButton('Cancel')
    assert.equal(confirmations, 0)
    saveMode = 'failure'
    await evaluate("window.testCommands.run('window-close-requested')")
    await waitFor(
      "document.querySelector('[role=dialog][data-state=open]')?.textContent.includes('Save changes before closing?')"
    )
    await clickButton('Save and close')
    await waitFor("document.body.textContent.includes('Save failed')")
    assert.equal(confirmations, 0)
    console.log('PASS: window cancellation and failed saving leave the window unconfirmed')

    await new Promise((resolve) => setTimeout(resolve, 300))
    sessionFailed = true
    await clickButton('Close without saving')
    await waitFor("document.body.textContent.includes('Session save failed')")
    assert.equal(confirmations, 0)
    sessionFailed = false
    sessionHeld = true
    await clickButton('Close without saving')
    await waitUntil(() => sessionSaveResolvers.length > 0)
    assert.equal(confirmations, 0)
    sessionHeld = false
    for (const resolve of sessionSaveResolvers) resolve()
    await waitUntil(() => confirmations === 1)
    const lastSession = persistedSessions.at(-1)
    assert.equal(lastSession.activePath, 'two-pages.pdf')
    assert.deepEqual(
      lastSession.tabs.map((tab) => tab.path),
      ['restored.pdf', 'new.pdf', 'two-pages.pdf']
    )
    assert.equal(lastSession.tabs.at(-1).page, 2)
    assert.equal(lastSession.theme, 'light')
    console.log(
      'PASS: window closure waits for current session persistence and aborts on persistence failure'
    )

    saveMode = 'success'
    await evaluate("window.testCommands.run('window-close-requested')")
    await waitFor(
      "document.querySelector('[role=dialog][data-state=open]')?.textContent.includes('Save changes before closing?')"
    )
    await clickButton('Save and close')
    await waitUntil(() => confirmations === 2)
    assert.equal(
      await evaluate(
        `document.querySelector('header button[title="two-pages.pdf"] .bg-foreground') !== null`
      ),
      false
    )
    console.log('PASS: saving dirty documents confirms window closure only after saving succeeds')

    await evaluate("window.testCommands.open('last-opened.pdf')")
    await waitFor(activeTab('last-opened.pdf'))
    await evaluate("window.testCommands.run('window-close-requested')")
    await waitUntil(() => confirmations === 3)
    assert.equal(persistedSessions.at(-1).activePath, 'last-opened.pdf')
    assert.equal(persistedSessions.at(-1).tabs.at(-1).path, 'last-opened.pdf')
    console.log(
      'PASS: clean window closure persists a newly opened tab before the debounce expires'
    )

    await waitFor('document.querySelector(\'[aria-label="Add image"]\')?.disabled === false')
    await new Promise((resolve) => setTimeout(resolve, 300))
    sessionSaveResolvers.length = 0
    sessionHeld = true
    await evaluate("window.testCommands.run('window-close-requested')")
    await waitUntil(() => sessionSaveResolvers.length > 0)
    await addImage()
    await waitFor(
      `document.querySelector('header button[title="last-opened.pdf"] .bg-foreground') !== null`
    )
    sessionHeld = false
    for (const resolve of sessionSaveResolvers) resolve()
    await waitFor(
      "document.querySelector('[role=dialog][data-state=open]')?.textContent.includes('Save changes before closing?')"
    )
    assert.equal(confirmations, 3)
    await clickButton('Close without saving')
    await waitUntil(() => confirmations === 4)
    console.log('PASS: annotations added during pending session persistence stop automatic closure')

    assert.deepEqual(rendererErrors, [])
    console.log(
      'PASS: password prompts belong to the active tab, retry correctly, and release the viewer on close'
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
