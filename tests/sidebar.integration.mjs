import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { blankPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-sidebar-'))
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
    directoryName: 'test',
    data: new Uint8Array(data).buffer,
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
  loadSession: async () => ({ tabs: ['empty.pdf', 'outline.pdf'].map(path => ({path,page:1,scale:'page-fit',scrollTop:0})), activePath:'outline.pdf', highlightColor:'#FDE047', theme:'light' }),
  readPdf: path => ipcRenderer.invoke('test:read',path),
  statPdf: async () => ({mtimeMs:1,size:1}), saveSession: async () => {}, closePdf: async () => {},
  openPdfDialog: async () => [], getPathForFile: () => '', confirmWindowClose: () => {},
  onOpenRequested: () => () => {}, onCommand: (name,cb) => {commands.set(name,cb);return () => commands.delete(name)}
})
contextBridge.exposeInMainWorld('testCommands',{run:name => commands.get(name)?.()})`
)
let win
const evaluate = (code) => win.webContents.executeJavaScript(code)
async function waitFor(code) {
  const deadline = Date.now() + 15000
  while (!(await evaluate(code))) {
    if (Date.now() > deadline) {
      fs.writeFileSync(
        '/tmp/lepis-sidebar-failure.png',
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
    `Array.from(document.querySelectorAll('.visible [role="tab"]')).find(el => el.textContent === '${name}').click()`
  )
app
  .whenReady()
  .then(async () => {
    win = new BrowserWindow({
      show: false,
      width: 1180,
      height: 780,
      webPreferences: { preload, sandbox: true, contextIsolation: true }
    })
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await waitFor(
      `document.querySelectorAll('.visible [aria-label^="Go to page"] canvas').length === 2 && Array.from(document.querySelectorAll('.visible [aria-label^="Go to page"] canvas')).every(canvas => canvas.width > 0)`
    )
    await waitFor(
      `document.querySelector('.visible [aria-label="Go to page 1"] canvas').getContext('2d').getImageData(10,10,1,1).data[0] === 255`
    )
    await waitFor(
      `document.querySelector('.visible [aria-label="Go to page 2"] canvas').getContext('2d').getImageData(10,10,1,1).data[2] === 255`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.visible [aria-label="Go to page 1"]').getAttribute('aria-current')`
      ),
      'page'
    )
    await evaluate(`document.querySelector('.visible [aria-label="Go to page 2"]').click()`)
    await waitFor(`document.querySelector('[aria-label="Current page"]').value === '2'`)
    await waitFor(
      `document.querySelector('.visible [aria-label="Go to page 2"]').getAttribute('aria-current') === 'page'`
    )
    console.log(
      'PASS: thumbnails render actual page content and navigate with current-page selection'
    )
    await clickTab('Outline')
    await waitFor(
      `document.querySelector('.visible [aria-label="Toggle section: Chapter one"]') !== null`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.visible [aria-label="Toggle section: Chapter one"]').getAttribute('aria-expanded')`
      ),
      'false'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.visible [role="tabpanel"]').textContent.includes('Section two')`
      ),
      false
    )
    await evaluate(
      `document.querySelector('.visible [aria-label="Toggle section: Chapter one"]').click()`
    )
    await waitFor(
      `document.querySelector('.visible [role="tabpanel"]').textContent.includes('Section two')`
    )
    assert.equal(
      await evaluate(`document.querySelectorAll('.visible [aria-label^="Go to page"]').length`),
      0
    )
    assert.equal(await evaluate(`document.querySelectorAll('.visible [role="tab"] svg').length`), 0)
    assert.equal(
      await evaluate(`document.querySelectorAll('[aria-label="Toggle PDF sidebar"]').length`),
      1
    )
    assert.ok(
      await evaluate(`document.querySelector('header [aria-label="Toggle PDF sidebar"]') !== null`)
    )
    await evaluate(
      `document.querySelector('.visible [aria-label="Toggle section: Chapter one"]').click()`
    )
    await waitFor(
      `!document.querySelector('.visible [role="tabpanel"]').textContent.includes('Section two')`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.visible [aria-label="Toggle section: Chapter one"]').getAttribute('aria-expanded')`
      ),
      'false'
    )
    await evaluate(
      `document.querySelector('.visible [aria-label="Toggle section: Chapter one"]').click()`
    )
    await waitFor(
      `document.querySelector('.visible [role="tabpanel"]').textContent.includes('Section two')`
    )
    console.log(
      'PASS: outline branches collapse independently and the toolbar owns the single sidebar toggle'
    )
    await evaluate(
      `Array.from(document.querySelectorAll('.visible [role="tabpanel"] button')).find(el => el.textContent === 'Chapter one').click()`
    )
    await waitFor(`document.querySelector('[aria-label="Current page"]').value === '1'`)
    await evaluate(
      `Array.from(document.querySelectorAll('.visible [role="tabpanel"] button')).find(el => el.textContent === 'Section two').click()`
    )
    await waitFor(`document.querySelector('[aria-label="Current page"]').value === '2'`)
    console.log('PASS: tab panels are separate and nested outline destinations navigate correctly')
    await clickTab('Pages')
    await waitFor(
      `document.querySelector('.visible [role=tab][aria-selected=true]').textContent === 'Pages'`
    )
    await waitFor(
      `document.querySelector('.visible [aria-current="page"]')?.getAttribute('aria-label') === 'Go to page 2'`
    )
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', {key: String.fromCharCode(92), metaKey: true, bubbles: true, cancelable: true}))`
    )
    await waitFor(`document.querySelector('.visible [aria-label="PDF navigation"]') === null`)
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', {key: String.fromCharCode(92), metaKey: true, bubbles: true, cancelable: true}))`
    )
    await waitFor(`document.querySelector('.visible [aria-label="PDF navigation"]') !== null`)
    console.log('PASS: Command-backslash closes and opens the sidebar through keyboard input')
    await evaluate(`document.querySelector('[aria-label="Toggle PDF sidebar"]').click()`)
    await waitFor(`document.querySelector('.visible [aria-label="PDF navigation"]') === null`)
    await evaluate(`document.querySelector('[aria-label="Toggle PDF sidebar"]').click()`)
    await waitFor(`document.querySelector('.visible [aria-label="PDF navigation"]') !== null`)
    await waitFor(
      `document.querySelector('.visible [role=tab][aria-selected=true]').textContent === 'Pages'`
    )
    await waitFor(`document.querySelector('.visible [aria-label="Go to page 2"] canvas').width > 0`)
    assert.ok(
      await evaluate(
        `document.querySelector('.visible [role=tabpanel]:not([hidden])').clientWidth > 200`
      ),
      'Tab content must use the sidebar width'
    )
    const bounds = await evaluate(
      `(() => { const sidebar = document.querySelector('.visible [aria-label="PDF navigation"]').getBoundingClientRect(); const viewer = document.querySelector('.visible .pdf-viewer-container').getBoundingClientRect(); return {sidebarRight:sidebar.right,viewerLeft:viewer.left,height:sidebar.height,windowHeight:innerHeight}; })()`
    )
    assert.equal(bounds.sidebarRight, bounds.viewerLeft)
    assert.ok(bounds.height < bounds.windowHeight, 'Sidebar must fit below the application toolbar')
    fs.writeFileSync('/tmp/lepis-sidebar.png', (await win.webContents.capturePage()).toPNG())
    console.log('PASS: sidebar toggles and stays within the document workspace')
    await evaluate(`window.testCommands.run('previous-tab')`)
    await waitFor(`document.querySelectorAll('.visible [aria-label^="Go to page"]').length === 1`)
    await clickTab('Outline')
    await waitFor(
      `document.querySelector('.visible [role="tabpanel"]').textContent.includes('This PDF has no outline.')`
    )
    console.log(
      'PASS: switching documents shows the matching pages and handles PDFs without an outline'
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
