import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { blankPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-search-'))
app.setPath('userData', temp)

const textStream = (text) => {
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
  return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
}
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
  textStream('Hello hello'),
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
  textStream('Hello world'),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
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
  const data = name === 'text.pdf' ? Buffer.from(pdf) : blankPdf
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
  setTheme: () => {},
  loadSession: async () => ({tabs:['blank.pdf','text.pdf'].map(path => ({path,page:1,scale:'page-fit',scrollTop:0})),activePath:'text.pdf',highlightColor:'#FDE047',theme:'light'}),
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
    if (Date.now() > deadline) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
const input = `document.querySelector('.visible input[aria-label="Find in PDF"]')`
const status = `document.querySelector('.visible [role="search"] [role="status"]').textContent`
const key = (key, modifiers = {}) =>
  evaluate(
    `${input}.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key, bubbles: true, cancelable: true, ...modifiers })}))`
  )
const query = (text) =>
  evaluate(`(() => {
  const input = ${input};
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});
  input.dispatchEvent(new Event('input',{bubbles:true}));
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
    await win.loadFile(path.join(root, 'out/renderer/index.html'))
    await waitFor(`document.querySelector('.visible .textLayer')?.textContent.includes('Hello')`)
    const viewerTop = await evaluate(
      `document.querySelector('.visible .pdf-viewer-container').getBoundingClientRect().top`
    )
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown',{key:'f',metaKey:true,bubbles:true,cancelable:true}))`
    )
    await waitFor(`${input} === document.activeElement`)
    assert.equal(
      await evaluate(
        `document.querySelector('.visible .pdf-viewer-container').getBoundingClientRect().top`
      ),
      viewerTop
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.visible [role="search"]').querySelectorAll('input,button').length`
      ),
      2
    )
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.visible [role="search"]')).position`
      ),
      'absolute'
    )
    await query('hello')
    await waitFor(`${status} === '1 of 3'`)
    await waitFor(`document.querySelectorAll('.visible .textLayer .highlight').length >= 2`)
    await key('Enter')
    await waitFor(`${status} === '2 of 3'`)
    await key('Enter')
    await waitFor(
      `${status} === '3 of 3' && document.querySelector('[aria-label="Current page"]').value === '2'`
    )
    await waitFor(
      `document.querySelector('.visible .page[data-page-number="2"] .highlight.selected') !== null`
    )
    await key('Enter')
    await waitFor(`${status} === '1 of 3'`)
    await key('Enter', { shiftKey: true })
    await waitFor(`${status} === '3 of 3'`)
    await key('f', { metaKey: true })
    await waitFor(`${input} === document.activeElement && ${input}.selectionEnd === 5`)
    console.log(
      'PASS: Cmd+F and menu command focus search; matches span pages, wrap, and highlight'
    )

    await query('missing')
    await waitFor(`${status} === 'No results'`)
    await query('')
    await waitFor(`${status} === '' && document.querySelector('.visible .highlight') === null`)
    await query('hello')
    await waitFor(`${status}.includes('of 3')`)
    await evaluate(`window.testCommands.run('previous-tab')`)
    await waitFor(`${input} === null`)
    await evaluate(`window.testCommands.run('find')`)
    await waitFor(`${input} === document.activeElement`)
    await query('hello')
    await waitFor(`${status} === 'No results'`)
    await evaluate(`window.testCommands.run('next-tab')`)
    await waitFor(`${input}.value === 'hello' && ${status}.includes('of 3')`)
    await key('Escape')
    await waitFor(`${input} === null && document.querySelector('.visible .highlight') === null`)
    assert.equal(
      await evaluate(`document.activeElement.matches('.visible .pdf-viewer-container')`),
      true
    )
    console.log('PASS: no results, cleared query, per-document search, and Escape cleanup')
    await evaluate(`window.testCommands.run('find')`)
    await waitFor(`${input} !== null`)
    await query('world')
    await waitFor(`${status} === '1 of 1'`)
    fs.writeFileSync('/tmp/lepis-search.png', (await win.webContents.capturePage()).toPNG())
    await evaluate(`document.querySelector('.visible [aria-label="Close search"]').click()`)
    await waitFor(`${input} === null && document.querySelector('.visible .highlight') === null`)
    console.log('PASS: close button dismisses search and removes highlights')
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
