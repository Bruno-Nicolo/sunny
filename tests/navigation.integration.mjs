import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { blankPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-navigation-'))
app.setPath('userData', temp)

// Exercise both explicit destinations and named destinations in a nested outline.
const objects = [
  '<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R /Names << /Dests << /Names [(second) [5 0 R /Fit]] >> >> >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',
  '<< /Length 24 >>\nstream\n1 0 0 rg 0 0 612 792 re f\nendstream',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << >> /Contents 6 0 R >>',
  '<< /Length 24 >>\nstream\n0 0 1 rg 0 0 792 612 re f\nendstream',
  '<< /Type /Outlines /First 8 0 R /Last 8 0 R /Count 2 >>',
  '<< /Title (Chapter one) /Parent 7 0 R /Dest [3 0 R /Fit] /First 9 0 R /Last 9 0 R /Count 1 >>',
  '<< /Title (Section two) /Parent 8 0 R /Dest (second) >>'
]
let pdf = '%PDF-1.7\n'
const offsets = [0]
for (const [index, object] of objects.entries()) {
  offsets.push(pdf.length)
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
}
const xref = pdf.length
pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  .join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
ipcMain.handle('test:read', (_, name) => {
  const data = name === 'outline.pdf' ? Buffer.from(pdf) : blankPdf
  return {
    path: name,
    name,
    directoryPath: 'test',
    source: { kind: 'memory', data: new Uint8Array(data).buffer },
    mtimeMs: 1,
    size: data.length
  }
})
const preload = path.join(temp, 'preload.cjs')
fs.writeFileSync(
  preload,
  `const { contextBridge, ipcRenderer } = require('electron')
const commands = new Map()
contextBridge.exposeInMainWorld('lepis', {
  releasePdfSource: async () => {},
  loadDrafts: async () => [], saveDraft: async () => {}, deleteDraft: async () => {},
  setTheme: () => {},
  loadSession: async () => ({ tabs: ['empty.pdf', 'outline.pdf'].map(path => ({path,page:1,scale:'page-fit',scrollTop:0})), activePath:'outline.pdf', highlightColor:'#FDE047', theme:'light' }),
  readPdf: path => ipcRenderer.invoke('test:read',path),
  statPdf: async () => ({mtimeMs:1,size:1}), saveSession: async () => {}, closePdf: async () => {},
  openPdfDialog: async () => [], getPathForFile: () => '', confirmWindowClose: () => {},
  onOpenRequested: () => () => {}, onCommand: (name,cb) => {commands.set(name,cb);return () => commands.delete(name)}
})
contextBridge.exposeInMainWorld('testCommands',{run:name => commands.get(name)?.()})`
)
let win
const evaluate = async (code) => {
  try {
    return await win.webContents.executeJavaScript(code)
  } catch (error) {
    throw new Error(`${error.message}\n${code}`, { cause: error })
  }
}
async function waitFor(code) {
  const deadline = Date.now() + 15000
  while (!(await evaluate(code))) {
    if (Date.now() > deadline) {
      fs.writeFileSync(
        '/tmp/lepis-navigation-failure.png',
        (await win.webContents.capturePage()).toPNG()
      )
      console.log(
        await evaluate(
          `({page:document.querySelector('[aria-label="Current page"]').value,scroll:document.querySelector('.visible .pdf-viewer-container').scrollTop})`
        )
      )
      throw new Error(`Timed out: ${code}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
const clickTab = (name) =>
  evaluate(
    `Array.from(document.querySelectorAll('[role="tab"]')).find(el => el.textContent === '${name}').click()`
  )
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
    const openNavigation = async () => {
      await evaluate(`document.querySelector('[aria-label="Toggle PDF navigation"]').click()`)
      await waitFor(`document.querySelector('[role="dialog"] [role="tab"]') !== null`)
    }
    const closed = () => waitFor(`document.querySelector('[role="dialog"]') === null`)
    await waitFor(`document.querySelector('.visible .pdfViewer .page canvas')?.width > 0`)
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]')`), null)
    const viewerBounds = () =>
      evaluate(
        `(() => {const r=document.querySelector('.visible .pdf-viewer-container').getBoundingClientRect();return {left:r.left,width:r.width}})()`
      )
    const before = await viewerBounds()
    assert.ok(
      await evaluate(`(() => {
      const button = document.querySelector('[aria-label="Toggle PDF navigation"]');
      const page = document.querySelector('[aria-label="Current page"]');
      return button.parentElement === page.parentElement.parentElement && button.getBoundingClientRect().right <= page.getBoundingClientRect().left;
    })()`),
      'Navigation button sits immediately before the page indicator'
    )
    await openNavigation()
    await waitFor(
      `document.querySelectorAll('[aria-label^="Go to page"] canvas').length === 2 && [...document.querySelectorAll('[aria-label^="Go to page"] canvas')].every(c=>c.width>0)`
    )
    assert.deepEqual(await viewerBounds(), before)
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Go to page 1"] canvas').getContext('2d').getImageData(10,10,1,1).data[0]`
      ),
      255
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Go to page 2"] canvas').getContext('2d').getImageData(10,10,1,1).data[2]`
      ),
      255
    )
    await evaluate(`document.querySelector('[aria-label="Go to page 2"]').click()`)
    await closed()
    await waitFor(`document.querySelector('[aria-label="Current page"]').value === '2'`)
    console.log(
      'PASS: modal thumbnails render page content, navigate and leave the viewer width unchanged'
    )
    await openNavigation()
    assert.equal(
      await evaluate(`document.querySelector('[aria-current="page"]').getAttribute('aria-label')`),
      'Go to page 2'
    )
    await clickTab('Outline')
    await waitFor(`document.querySelector('[aria-label="Toggle section: Chapter one"]') !== null`)
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Toggle section: Chapter one"]').getAttribute('aria-expanded')`
      ),
      'false'
    )
    await evaluate(`document.querySelector('[aria-label="Toggle section: Chapter one"]').click()`)
    await waitFor(`document.querySelector('[role="tabpanel"]').textContent.includes('Section two')`)
    await evaluate(`document.querySelector('[aria-label="Toggle section: Chapter one"]').click()`)
    await waitFor(
      `!document.querySelector('[role="tabpanel"]').textContent.includes('Section two')`
    )
    await evaluate(
      `Array.from(document.querySelectorAll('[role="tabpanel"] button')).find(el=>el.lastElementChild?.textContent==='Chapter one').click()`
    )
    await closed()
    await waitFor(`document.querySelector('[aria-label="Current page"]').value === '1'`)
    await openNavigation()
    await waitFor(
      `document.querySelector('[role="tab"][aria-selected="true"]').textContent === 'Outline'`
    )
    await evaluate(`document.querySelector('[aria-label="Toggle section: Chapter one"]').click()`)
    await evaluate(
      `Array.from(document.querySelectorAll('[role="tabpanel"] button')).find(el=>el.lastElementChild?.textContent==='Section two').click()`
    )
    await closed()
    await waitFor(`document.querySelector('[aria-label="Current page"]').value === '2'`)
    console.log(
      'PASS: outline branches expand and collapse; explicit and named destinations close the modal'
    )
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown',{key:String.fromCharCode(92),metaKey:true,bubbles:true,cancelable:true}))`
    )
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]')`), null)
    await openNavigation()
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await closed()
    await waitFor(
      `document.activeElement === document.querySelector('[aria-label="Toggle PDF navigation"]')`
    )
    console.log('PASS: navigation has no keyboard shortcut; Escape closes it and restores focus')
    await evaluate(`window.testCommands.run('previous-tab')`)
    await waitFor(
      `document.querySelector('[aria-label="empty.pdf"]').getAttribute('aria-pressed') === 'true'`
    )
    await openNavigation()
    await waitFor(
      `document.querySelector('[role="tabpanel"]').textContent.includes('This PDF has no outline.')`
    )
    await clickTab('Pages')
    await waitFor(`document.querySelectorAll('[aria-label^="Go to page"]').length === 1`)
    console.log('PASS: navigation shows the active document and handles PDFs without an outline')
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
