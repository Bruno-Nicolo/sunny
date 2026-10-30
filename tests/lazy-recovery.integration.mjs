import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { blankPdf, createPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-lazy-recovery-'))
app.setPath('userData', temp)
const recovered = createPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>',
  '<< /Length 0 >>\nstream\n\nendstream',
  '<< /Type /Annot /Subtype /FreeText /Rect [50 600 200 630] /Contents (Recovered annotation) /DA (/Helvetica 12 Tf 0 g) /F 4 >>'
])
const saved = new Map()
const deleted = []
let confirmed = false
ipcMain.handle('draft:load', () =>
  [
    { path: 'active.pdf', name: 'active.pdf', bytes: blankPdf },
    { path: 'unopened.pdf', name: 'unopened.pdf', bytes: recovered }
  ].map(({ path, name, bytes }) => ({
    path,
    name,
    directoryPath: 'test',
    source: { kind: 'memory', data: new Uint8Array(bytes).buffer },
    mtimeMs: 1,
    size: bytes.length,
    savedAt: 1
  }))
)
ipcMain.handle('pdf:save', (_event, payload) => {
  saved.set(payload.filePath, new Uint8Array(payload.data))
  return { mtimeMs: 2, size: payload.data.length }
})
ipcMain.handle('draft:delete', (_event, path) => {
  deleted.push(path)
})
ipcMain.on('window:confirm', () => {
  confirmed = true
})
const preload = path.join(temp, 'preload.cjs')
fs.writeFileSync(
  preload,
  `const {contextBridge,ipcRenderer}=require('electron')
const commands=new Map()
contextBridge.exposeInMainWorld('lepis',{
 loadDrafts:()=>ipcRenderer.invoke('draft:load'),saveDraft:async()=>{},deleteDraft:path=>ipcRenderer.invoke('draft:delete',path),
 releasePdfSource:async()=>{},setTheme:()=>{},loadSession:async()=>({tabs:[],activePath:null,highlightColor:'#FDE047',theme:'light'}),
 readPdf:async()=>{throw new Error('Recovery must not read the original PDF')},statPdf:async()=>({mtimeMs:1,size:1}),
 savePdf:payload=>ipcRenderer.invoke('pdf:save',payload),saveSession:async()=>{},closePdf:async()=>{},
 openPdfDialog:async()=>[],getPathForFile:()=>'',confirmWindowClose:()=>ipcRenderer.send('window:confirm'),
 onOpenRequested:()=>()=>{},onCommand:(name,callback)=>{commands.set(name,callback);return()=>commands.delete(name)}
})
contextBridge.exposeInMainWorld('testCommands',{run:name=>commands.get(name)?.()})`
)
let win
const evaluate = (code) => win.webContents.executeJavaScript(code)
async function waitFor(check) {
  const start = Date.now()
  while (!(await (typeof check === 'string' ? evaluate(check) : check()))) {
    if (Date.now() - start > 15000) throw new Error(`Timed out: ${check}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
const click = (label) =>
  evaluate(
    `Array.from(document.querySelectorAll('[role=dialog] button')).find(button=>button.textContent==='${label}').click()`
  )
async function main() {
  let failed = false
  try {
    await app.whenReady()
    win = new BrowserWindow({
      show: false,
      width: 1180,
      height: 780,
      webPreferences: {
        preload,
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await enableTestFocus(win)
    await waitFor(
      `Array.from(document.querySelectorAll('[role=dialog] button')).some(button=>button.textContent==='Recover changes')`
    )
    await click('Recover changes')
    await waitFor(`document.querySelector('.visible .canvasWrapper canvas') !== null`)
    assert.equal(await evaluate(`document.querySelectorAll('.invisible .page').length`), 0)
    await evaluate(`window.testCommands.run('window-close-requested')`)
    await waitFor(
      `document.querySelector('[role=dialog]')?.textContent.includes('2 documents have unsaved annotations.')`
    )
    await click('Save and close')
    await waitFor(() => confirmed)
    assert.deepEqual(saved.get('unopened.pdf'), recovered)
    assert.deepEqual([...saved.keys()].sort(), ['active.pdf', 'unopened.pdf'])
    assert.ok(deleted.includes('unopened.pdf'))
    assert.equal(await evaluate(`document.querySelectorAll('.invisible .page').length`), 0)
    console.log(
      'PASS: save-all preserves an unopened recovered PDF without starting its viewer or reading the original'
    )
  } catch (error) {
    failed = true
    console.error(error)
  } finally {
    win?.destroy()
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    app.exit(failed ? 1 : 0)
  }
}
void main()
