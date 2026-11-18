import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { pathToFileURL } from 'node:url'
import { createPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, ipcMain, protocol } = electron
app.on('window-all-closed', () => {})
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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-annotation-performance-'))
app.setPath('userData', temp)
for (const name of ['pdf-sources', 'atomic-write', 'pdf-files']) {
  const { outputText } = ts.transpileModule(
    fs.readFileSync(path.join(root, 'src/main', name + '.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
  )
  fs.writeFileSync(
    path.join(temp, name + '.mjs'),
    outputText
      .replace("from './pdf-sources'", "from './pdf-sources.mjs'")
      .replace("from './atomic-write'", "from './atomic-write.mjs'")
  )
}
const { readPdf, statPdf } = await import(pathToFileURL(path.join(temp, 'pdf-files.mjs')).href)
const { createPdfResponse, releasePdfSource } = await import(
  pathToFileURL(path.join(temp, 'pdf-sources.mjs')).href
)
const filePath = path.join(temp, 'stress.pdf')
let bytesRead = 0
let sourceOpeningMs = 0
let documentReads = 0
const pageCount = Number(process.env.LEPIS_PERF_PAGES ?? 300)
const perPage = Number(process.env.LEPIS_PERF_ANNOTATIONS_PER_PAGE ?? 200)
const densePage = 3000
const visits = Number(process.env.LEPIS_PERF_VISITS ?? 60)
let fileBytes
let win
let annotated = false
const errors = []
let gcIntervals = []

// Real vector drawing operations make this a rendering workload, not a padded blank PDF.
function fixture(withAnnotations) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const pages = []
  for (let page = 0; page < pageCount; page++) {
    const pageId = objects.length + 1
    pages.push(`${pageId} 0 R`)
    objects.push('')
    const contentId = objects.length + 1
    const content = [
      `BT /F1 18 Tf 30 760 Td (Performance page ${page + 1}) Tj ET`,
      ...Array.from({ length: 2500 }, (_, i) => {
        const x = 20 + (i % 50) * 11
        const y = 20 + Math.floor(i / 50) * 14
        return `q 0.${(i % 8) + 1} 0.4 0.7 rg ${x} ${y} 5 5 re f Q`
      })
    ].join('\n')
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    const ids = []
    const count = withAnnotations ? (page === 0 ? densePage : perPage) : 0
    for (let i = 0; i < count; i++) {
      ids.push(`${objects.length + 1} 0 R`)
      const x = 20 + (i % 20) * 28
      const y = 25 + (Math.floor(i / 20) % 45) * 15
      objects.push(
        `<< /Type /Annot /Subtype /Highlight /Rect [${x} ${y} ${x + 20} ${y + 10}] /QuadPoints [${x} ${y + 10} ${x + 20} ${y + 10} ${x} ${y} ${x + 20} ${y}] /C [1 1 0] /F 4 >>`
      )
    }
    objects[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R /Annots [${ids.join(' ')}] >>`
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] = `<< /Type /Pages /Kids [${pages.join(' ')}] /Count ${pageCount} >>`
  return Buffer.from(createPdf(objects))
}

ipcMain.handle('test:stat', () => statPdf(filePath))
ipcMain.handle('test:read', async () => {
  documentReads++
  const start = performance.now()
  const pdf = await readPdf(filePath)
  sourceOpeningMs = performance.now() - start
  return pdf
})
ipcMain.handle('test:release', (_event, source) => releasePdfSource(source))
const preload = path.join(temp, 'preload.cjs')
fs.writeFileSync(
  preload,
  `const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('lepis', {
 releasePdfSource: source=>ipcRenderer.invoke('test:release',source),
 loadDrafts: async () => [], saveDraft: async () => {}, deleteDraft: async () => {}, setTheme: () => {},
 loadSession: async () => ({tabs:[{path:${JSON.stringify(filePath)},page:1,scale:'page-fit',scrollTop:0}],activePath:${JSON.stringify(filePath)},highlightColor: '#FDE047', highlightOpacity: 0.9, highlightThickness: 12,theme:'light'}),
 readPdf: () => ipcRenderer.invoke('test:read'), statPdf: () => ipcRenderer.invoke('test:stat'),
 saveSession: async () => {}, closePdf: async () => {}, openPdfDialog: async () => [],
 getPathForFile: () => '', confirmWindowClose: () => {}, onOpenRequested: () => () => {}, onCommand: () => () => {}
})
let previous = performance.now()
const stalls = []
const longTasks = []
new PerformanceObserver(list => { for (const task of list.getEntries()) longTasks.push({from:task.startTime,to:task.startTime+task.duration,delay:task.duration}) }).observe({type:'longtask',buffered:true})
setInterval(() => { const now = performance.now(); stalls.push({from:previous,to:now,delay:Math.max(0, now-previous-20)}); previous=now },20)
contextBridge.exposeInMainWorld('performanceProbe',{stalls:()=>stalls.slice(),longTasks:()=>longTasks.slice()})`
)

async function evaluate(code, timeoutMs = 5000) {
  let timer
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(code),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Evaluation timed out: ${code.slice(0, 160)}`)),
          timeoutMs
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
async function waitFor(code) {
  const start = performance.now()
  while (!(await evaluate(code))) {
    if (performance.now() - start > 15000) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
async function heap() {
  const before = await evaluate('performance.now()')
  await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage')
  const used =
    (await win.webContents.debugger.sendCommand('Runtime.getHeapUsage')).usedSize / 1024 / 1024
  const after = await evaluate('performance.now()')
  gcIntervals.push([before, after + 40])
  return used
}
function percentile(values, fraction) {
  return [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ]
}
const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
async function goTo(page) {
  const start = performance.now()
  await evaluate(
    `(() => {
      const input = document.querySelector('[aria-label="Current page"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${page}');
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`
  )
  try {
    await waitFor(
      `document.querySelector('[aria-label="Current page"]').value === '${page}' && document.querySelector('.visible .page[data-page-number="${page}"] .canvasWrapper canvas') !== null && document.querySelector('.visible .page[data-page-number="${page}"] .lepisAnnotationLayer')?.querySelectorAll('[data-annotation-key]').length === ${annotated ? (page === 1 ? densePage : perPage) : 0}`
    )
  } catch (error) {
    console.error(
      await evaluate(`(() => {
      const container=document.querySelector('.visible .pdf-viewer-container');
      const target=document.querySelector('.visible .page[data-page-number="${page}"]');
      const first=document.querySelector('.visible .page[data-page-number="1"]');
      const box=node=>{const r=node.getBoundingClientRect();return {top:r.top,left:r.left,width:r.width,height:r.height}};
      return {targetPage:${page}, scrollTop:container.scrollTop, scrollHeight:container.scrollHeight, container:box(container),target:box(target),first:box(first),windowScrollY:window.scrollY,activeElement:document.activeElement?.outerHTML.slice(0,250)};
    })()`)
    )
    throw error
  }
  if (page % 5 === 0) await evaluate(`window.dispatchEvent(new Event('focus'))`)
  await evaluate(frame)
  return performance.now() - start
}
async function measureThumbnailEdits() {
  await evaluate(`document.querySelector('[aria-label="Toggle PDF navigation"]').click()`)
  await waitFor(`(() => {
    const panel=document.querySelector('[role="tabpanel"]');if(!panel)return false;
    const bounds=panel.getBoundingClientRect();
    return [...panel.querySelectorAll('[aria-label^="Go to page"]')].filter(button=>{const r=button.getBoundingClientRect();return r.bottom>bounds.top-200 && r.top<bounds.bottom+200}).every(button=>button.querySelector('canvas').width>0);
  })()`)
  await evaluate(
    `(() => {const tool=document.querySelector('[aria-label="Highlight text"]');if(tool.getAttribute('aria-pressed')!=='true')tool.click()})()`
  )
  await waitFor(`document.querySelector('[aria-label="Highlight color"]')!==null`)
  await new Promise((resolve) => setTimeout(resolve, 250))
  await evaluate(`(() => {
    window.thumbnailPaints=0;window.thumbnailEditTimes=[];window.pdfContentPaints=0;window.thumbnailEditStart=null;window.thumbnailBase=null;
    const thumbnail=document.querySelector('[aria-label="Go to page 1"] canvas');
    const context=thumbnail.getContext('2d');const draw=context.drawImage;
    context.drawImage=function(...args){window.thumbnailBase=args[0];const result=draw.apply(this,args);window.thumbnailPaints++;if(window.thumbnailEditStart!==null){queueMicrotask(()=>{window.thumbnailEditTimes.push(performance.now()-window.thumbnailEditStart);window.thumbnailEditStart=null})}return result};
    // Other grid thumbnails may still render; count only the bitmap used by the edited page.
    const fill=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(...args){if(this.canvas===window.thumbnailBase)window.pdfContentPaints++;return fill.apply(this,args)};
    document.querySelector('.visible .page[data-page-number="1"] .highlightEditor').dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
  })()`)
  const colors = ['Green', 'Pink', 'Yellow']
  for (let i = 0; i < 30; i++) {
    const next = colors[i % colors.length]
    await evaluate(
      `window.thumbnailEditStart=performance.now();document.querySelector('[aria-label="Highlight color"] [aria-label="${next}"]').click()`
    )
    await waitFor(`window.thumbnailEditTimes.length === ${i + 1}`)
  }
  const result = await evaluate(
    `({times:window.thumbnailEditTimes,paints:window.thumbnailPaints,pdfContentPaints:window.pdfContentPaints})`
  )
  assert.equal(result.pdfContentPaints, 0, 'Editing annotations must reuse the PDF bitmap')
  assert.equal(result.paints, 30, 'Each edit must redraw only the changed thumbnail')
  assert.ok(percentile(result.times, 0.95) < 150, 'Thumbnail editing latency exceeded 150ms')
  return {
    thumbnailEditP95Ms: Math.round(percentile(result.times, 0.95)),
    thumbnailEditMaxMs: Math.round(Math.max(...result.times)),
    thumbnailEdits: 30,
    pdfContentPaintsDuringEdits: result.pdfContentPaints
  }
}
async function run(withAnnotations) {
  annotated = withAnnotations
  gcIntervals = []
  console.log(
    `START: ${annotated ? `${densePage + (pageCount - 1) * perPage} highlights` : 'unannotated baseline'}`
  )
  const data = fixture(annotated)
  fs.writeFileSync(filePath, data)
  if (process.env.LEPIS_PERF_SPARSE_GB) {
    const newId = Number(data.toString('latin1').match(/trailer\s*<< \/Size (\d+)/)[1])
    const previous = Number(data.toString('latin1').match(/startxref\s+(\d+)\s+%%EOF/)[1])
    const padding = Number(process.env.LEPIS_PERF_SPARSE_GB) * 1024 * 1024 * 1024
    const prefix = Buffer.from(`${newId} 0 obj\n<< /Length ${padding} >>\nstream\n`)
    const end = Buffer.from('\nendstream\nendobj\n')
    const xref = data.length + prefix.length + padding + end.length
    const suffix = Buffer.from(
      `xref\n${newId} 1\n${String(data.length).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${newId + 1} /Root 1 0 R /Prev ${previous} >>\nstartxref\n${xref}\n%%EOF\n`
    )
    const fd = fs.openSync(filePath, 'r+')
    try {
      fs.writeSync(fd, prefix, 0, prefix.length, data.length)
      fs.ftruncateSync(fd, xref + suffix.length)
      fs.writeSync(fd, end, 0, end.length, xref - end.length)
      fs.writeSync(fd, suffix, 0, suffix.length, xref)
    } finally {
      fs.closeSync(fd)
    }
  }
  fileBytes = fs.statSync(filePath).size
  console.log(`FIXTURE: ${(fileBytes / 1024 / 1024).toFixed(1)} MB`)

  win = new BrowserWindow({
    show: false,
    focusable: false,
    width: 1180,
    height: 780,
    webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false }
  })
  win.webContents.on('render-process-gone', (_, details) =>
    errors.push(`Renderer crashed: ${details.reason}`)
  )
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message)
  })
  win.setIgnoreMouseEvents(true)
  win.showInactive()
  win.webContents.debugger.attach('1.3')
  const start = performance.now()
  await win.loadFile(path.join(root, 'out/renderer/index.html'))
  await waitFor(
    `document.querySelectorAll('.visible .page').length === ${pageCount} && document.querySelector('.visible .page[data-page-number="1"] .lepisAnnotationLayer')?.querySelectorAll('[data-annotation-key]').length === ${annotated ? densePage : 0} && document.querySelector('[aria-label="Highlight text"]')?.disabled === false`
  )
  await evaluate(frame)
  const opening = performance.now() - start
  const openingBytes = bytesRead
  const openedAt = await evaluate('performance.now()')
  console.log(`OPENED: ${Math.round(opening)} ms`)
  const initialHeap = await heap()
  const initialEditors = await evaluate(
    "document.querySelectorAll('.lepisAnnotationLayer [data-annotation-key]').length"
  )
  assert.ok(
    initialEditors < densePage + perPage * 5,
    'Opening must not create editors for the whole document'
  )
  await evaluate(
    `window.canvasBefore=document.querySelector('.page[data-page-number="1"] .canvasWrapper canvas');window.layerBefore=document.querySelector('.page[data-page-number="1"] .lepisAnnotationLayer');window.editorBefore=window.layerBefore.firstElementChild`
  )
  const tools = await evaluate(
    `(async()=>{const times=[];for(let i=0;i<100;i++){const start=performance.now();document.querySelector('[aria-label="Highlight text"]').click();await ${frame};times.push(performance.now()-start)}return times})()`,
    20000
  )
  console.log(`TOOLS: p95 ${Math.round(percentile(tools, 0.95))} ms`)
  assert.deepEqual(
    await evaluate(
      `({canvas: window.canvasBefore === document.querySelector('.page[data-page-number="1"] .canvasWrapper canvas'), layer: window.layerBefore === document.querySelector('.page[data-page-number="1"] .lepisAnnotationLayer'), editor: window.editorBefore === window.layerBefore.firstElementChild})`
    ),
    { canvas: true, layer: true, editor: true },
    'Tool changes must retain the page and editors'
  )
  await evaluate('window.canvasBefore = window.layerBefore = window.editorBefore = null')
  const toolsEndedAt = await evaluate('performance.now()')
  const navigation = []
  for (let i = 0; i < visits; i++)
    navigation.push(await goTo(2 + Math.floor((i * (pageCount - 2)) / (visits - 1))))
  await goTo(1)
  const firstRoundEndedAt = await evaluate('performance.now()')
  const warmedHeap = await heap()
  // Revisit the same pages to distinguish retained imports from repeated DOM/listener leaks.
  for (let i = 0; i < visits; i++) await goTo(2 + Math.floor((i * (pageCount - 2)) / (visits - 1)))
  await goTo(1)
  const documentCleanAfterNavigation = await evaluate(
    `document.querySelector('[aria-label="stress.pdf"] > span.size-2') === null`
  )
  const finalHeap = await heap()
  // Forced debugger GC is measurement overhead; exclude its pauses from UI latency.
  const probes = await evaluate('window.performanceProbe.stalls()')
  const relevantProbes = probes.filter(
    (probe) => !gcIntervals.some(([from, to]) => probe.from <= to && probe.to >= from)
  )
  const stalls = probes
    .filter((probe) => !gcIntervals.some(([from, to]) => probe.from <= to && probe.to >= from))
    .map((probe) => probe.delay)
  const longTasks = (await evaluate('window.performanceProbe.longTasks()')).filter(
    (probe) => !gcIntervals.some(([from, to]) => probe.from <= to && probe.to >= from)
  )
  const rendererMemory = app
    .getAppMetrics()
    .find((metric) => metric.pid === win.webContents.getOSProcessId())?.memory
  const result = {
    annotated,
    pages: pageCount,
    annotations: annotated ? densePage + (pageCount - 1) * perPage : 0,
    fileMB: +(fileBytes / 1024 / 1024).toFixed(1),
    openingReadMB: +(openingBytes / 1024 / 1024).toFixed(2),
    totalReadMB: +(bytesRead / 1024 / 1024).toFixed(2),
    openingMs: Math.round(opening),
    documentReads,
    sourceOpeningMs: Math.round(sourceOpeningMs),
    toolP95Ms: Math.round(percentile(tools, 0.95)),
    toolMaxMs: Math.round(Math.max(...tools)),
    pageP95Ms: Math.round(percentile(navigation, 0.95)),
    slowestStalls: [...relevantProbes]
      .sort((a, b) => b.delay - a.delay)
      .slice(0, 3)
      .map((probe) => ({
        ms: Math.round(probe.delay),
        phase:
          probe.to < openedAt
            ? 'opening'
            : probe.to < toolsEndedAt
              ? 'tools'
              : probe.to < firstRoundEndedAt
                ? 'first round'
                : 'second round'
      })),
    maxEventLoopDelayMs: Math.round(Math.max(...stalls)),
    maxLongTaskMs: Math.round(Math.max(0, ...longTasks.map((task) => task.delay))),
    maxInteractiveLongTaskMs: Math.round(
      Math.max(0, ...longTasks.filter((task) => task.from >= openedAt).map((task) => task.delay))
    ),
    rendererResidentMB: rendererMemory ? +(rendererMemory.workingSetSize / 1024).toFixed(1) : null,
    initialHeapMB: +initialHeap.toFixed(1),
    warmedHeapMB: +warmedHeap.toFixed(1),
    finalHeapMB: +finalHeap.toFixed(1),
    orphanLayers: await evaluate(
      "[...document.querySelectorAll('.lepisAnnotationLayer')].filter(layer=>!layer.parentElement.querySelector('.canvasWrapper canvas')).length"
    ),
    retainedLayers: await evaluate("document.querySelectorAll('.lepisAnnotationLayer').length"),
    retainedEditors: await evaluate(
      "document.querySelectorAll('.lepisAnnotationLayer [data-annotation-key]').length"
    )
  }
  if (process.env.LEPIS_PERF_THUMBNAIL_EDITS) {
    Object.assign(result, await measureThumbnailEdits())
  }
  console.log(JSON.stringify(result))
  if (process.env.LEPIS_PERF_REPORT)
    fs.writeFileSync(process.env.LEPIS_PERF_REPORT, JSON.stringify(result, null, 2))
  assert.equal(documentReads, 1, 'Focus and navigation must not reload an unchanged PDF')
  assert.ok(
    openingBytes < Number(process.env.LEPIS_PERF_OPENING_READ_MB ?? 8) * 1024 * 1024,
    'Opening read too much of the file'
  )
  assert.ok(result.orphanLayers === 0, 'Evicted pages retained annotation layers without a canvas')
  assert.ok(result.retainedLayers <= 8, 'Annotation DOM exceeded the page cache')
  assert.ok(result.maxLongTaskMs < 250, 'Startup or interface task exceeded 250ms')
  assert.ok(result.maxInteractiveLongTaskMs < 200, 'Interactive task exceeded 200ms')
  assert.ok(result.rendererResidentMB < 768, 'Renderer resident memory exceeded 768MB')
  assert.ok(opening < 2000, 'First page opening exceeded 2 seconds')
  assert.ok(result.toolP95Ms < 150, 'Tool switching p95 exceeded 150ms')
  assert.ok(result.pageP95Ms < 500, 'Page navigation p95 exceeded 500ms')
  assert.ok(result.maxEventLoopDelayMs < 500, 'Renderer stalled for more than 500ms')
  assert.ok(finalHeap - warmedHeap < 30, 'Repeated navigation retained more than 30MB')
  assert.equal(
    documentCleanAfterNavigation,
    true,
    'Navigation and tools must leave the document clean'
  )
  win.webContents.debugger.detach()
  const closed = new Promise((resolve) => win.once('closed', resolve))
  win.destroy()
  await closed
  await new Promise(setImmediate)
  win = null
  return result
}
async function main() {
  let failed = false
  try {
    await app.whenReady()
    protocol.handle('lepis-pdf', async (request) => {
      const response = await createPdfResponse(request)
      if (!response.body) return response
      const stream = response.body.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            bytesRead += chunk.byteLength
            controller.enqueue(chunk)
          }
        })
      )
      return new Response(stream, { status: response.status, headers: response.headers })
    })
    await run(process.env.LEPIS_PERF_ANNOTATED !== '0')
    assert.deepEqual(errors, [])
    console.log(
      `PASS: dense-page tool changes, large annotated PDF opening, ${visits * 2} page visits, bounded memory and clean state`
    )
  } catch (error) {
    failed = true
    console.error(error)
    console.error({
      rendererErrors: errors,
      currentPage:
        win && !win.isDestroyed()
          ? await evaluate(`document.querySelector('[aria-label="Current page"]')?.value`)
          : null
    })
  } finally {
    if (win && !win.isDestroyed()) {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
      const closed = new Promise((resolve) => win.once('closed', resolve))
      win.destroy()
      await closed
      await new Promise(setImmediate)
    }
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    app.exit(failed ? 1 : 0)
  }
}
void main().catch((error) => {
  console.error(error)
  app.exit(1)
})
