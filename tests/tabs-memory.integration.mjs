import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { blankPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lepis-tabs-memory-'))
app.setPath('userData', temp)
// Catch React's development prop expansion without allocating the default 2 GB heap.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=384')
for (const name of ['atomic-write', 'pdf-files']) {
  const source = await fs.readFile(path.join(root, 'src/main', `${name}.ts`), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  })
  await fs.writeFile(
    path.join(temp, `${name}.mjs`),
    outputText.replace("from './atomic-write'", "from './atomic-write.mjs'")
  )
}
const { readPdf, statPdf } = await import(pathToFileURL(path.join(temp, 'pdf-files.mjs')).href)
const bytes = Buffer.alloc(32 * 1024 * 1024, 32)
bytes.set(blankPdf)
const paths = ['first.pdf', 'second.pdf'].map((name) => path.join(temp, name))
for (const filePath of paths) await fs.writeFile(filePath, bytes)
ipcMain.handle('pdf:read', (_, filePath) => readPdf(filePath))
ipcMain.handle('pdf:stat', (_, filePath) => statPdf(filePath))
ipcMain.handle('pdf:close', () => {})
ipcMain.handle('session:save', () => {})
ipcMain.handle('session:load', () => ({
  tabs: paths.map((filePath) => ({ path: filePath, page: 1, scale: 'page-fit', scrollTop: 0 })),
  activePath: paths[1],
  highlightColor: '#FDE047',
  theme: 'light'
}))
let win
let server
let failure
const rendererErrors = []
async function evaluate(code) {
  let timer
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(code),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Renderer stalled during a tab operation')), 5000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
async function waitFor(code) {
  const start = Date.now()
  while (!(await evaluate(code))) {
    if (failure) throw failure
    if (Date.now() - start > 15000) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
async function heap() {
  await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage')
  return (await win.webContents.debugger.sendCommand('Runtime.getHeapUsage')).usedSize / 1024 / 1024
}
async function run() {
  try {
    await app.whenReady()
    server = await createServer({
      configFile: false,
      root: path.join(root, 'src/renderer'),
      resolve: { alias: { '@': path.join(root, 'src/renderer/src') } },
      plugins: [react(), tailwindcss()],
      server: { host: '127.0.0.1', port: 0, strictPort: true }
    })
    await server.listen()
    win = new BrowserWindow({
      show: false,
      width: 1180,
      height: 780,
      webPreferences: {
        preload: path.join(root, 'out/preload/index.js'),
        sandbox: true,
        contextIsolation: true
      }
    })
    win.webContents.on('render-process-gone', (_, details) => {
      failure = new Error(`Renderer crashed: ${details.reason} (exit ${details.exitCode})`)
      console.error(failure.message)
    })
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') rendererErrors.push(details.message)
    })
    win.webContents.debugger.attach('1.3')
    await win.loadURL(server.resolvedUrls.local[0])
    await waitFor(
      "document.querySelector('[aria-label=\"Add image\"]')?.disabled === false && document.querySelectorAll('header button[title]').length === 2 && !document.body.textContent.includes('Opening document')"
    )
    const baseline = await heap()
    for (let i = 0; i < 40; i++) {
      win.webContents.send('menu:next-tab')
      await evaluate(
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'
      )
      if (i % 10 === 0) {
        const used = await heap()
        assert.ok(
          used - baseline < 40,
          `Tab switching retained ${(used - baseline).toFixed(1)} MB of heap`
        )
      }
    }
    for (let i = 0; i < 3; i++) {
      const closedPath = await evaluate(
        "Array.from(document.querySelectorAll('header button[title]')).find(button=>button.classList.contains('document-tab-active')).title"
      )
      win.webContents.send('menu:close-tab')
      await waitFor("document.querySelectorAll('header button[title]').length === 1")
      win.webContents.send('file:open-requested', closedPath)
      await waitFor(
        "document.querySelectorAll('header button[title]').length === 2 && !document.body.textContent.includes('Opening document')"
      )
    }
    const final = await heap()
    assert.ok(
      final - baseline < 40,
      `Opening/closing tabs retained ${(final - baseline).toFixed(1)} MB of heap`
    )
    assert.equal(failure, undefined)
    assert.deepEqual(rendererErrors, [])
    console.log(
      `PASS: development renderer handles 32 MB PDFs, 40 tab switches and repeated close/open; heap ${baseline.toFixed(1)} → ${final.toFixed(1)} MB`
    )
  } catch (error) {
    failure = error
    console.error(error)
  } finally {
    await server?.close()
    await fs.rm(temp, { recursive: true, force: true })
    win?.destroy()
    app.exit(failure ? 1 : 0)
  }
}
void run()
