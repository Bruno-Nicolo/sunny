import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { blankPdf, createPdf } from './fixtures/pdf.mjs'

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-navigation-'))
app.setPath('userData', temp)

// Exercise both explicit destinations and named destinations in a nested outline.
const objects = [
  '<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R /Names << /Dests << /Names [(second) [5 0 R /Fit]] >> >> >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R /Annots [10 0 R] >>',
  '<< /Length 24 >>\nstream\n1 0 0 rg 0 0 612 792 re f\nendstream',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << >> /Contents 6 0 R >>',
  '<< /Length 24 >>\nstream\n0 0 1 rg 0 0 792 612 re f\nendstream',
  '<< /Type /Outlines /First 8 0 R /Last 8 0 R /Count 2 >>',
  '<< /Title (Chapter one) /Parent 7 0 R /Dest [3 0 R /Fit] /First 9 0 R /Last 9 0 R /Count 1 >>',
  '<< /Title (Section two) /Parent 8 0 R /Dest (second) >>',
  '<< /Type /Annot /Subtype /FreeText /Rect [100 100 200 130] /Contents (Page note) /DA (/Helvetica 12 Tf 0 g) /P 3 0 R >>'
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
const multiObjects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] /Count 5 >>',
  ...Array.from(
    { length: 5 },
    (_, i) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${500 + i * 50} 800] /Resources << >> >>`
  )
]
const multiPdf = createPdf(multiObjects)
const manyPdf = createPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Kids [${Array.from({ length: 12 }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count 12 >>`,
  ...Array.from(
    { length: 12 },
    () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>'
  )
])
ipcMain.handle('test:read', (_, name) => {
  const data =
    name === 'export.pdf'
      ? exportedPdf
      : name === 'outline.pdf'
        ? Buffer.from(pdf)
        : name === 'multi.pdf'
          ? multiPdf
          : name === 'many.pdf'
            ? manyPdf
            : blankPdf
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
  loadSession: async () => ({ tabs: ['many.pdf', 'multi.pdf', 'empty.pdf', 'outline.pdf'].map(path => ({path,page:1,scale:'page-fit',scrollTop:0})), activePath:'outline.pdf', highlightColor: '#FDE047', highlightOpacity: 0.9, highlightThickness: 12, theme:'light' }),
  readPdf: path => ipcRenderer.invoke('test:read',path),
  savePdf: payload => ipcRenderer.invoke('test:save', payload),
  choosePdfCopy: destination => ipcRenderer.invoke('test:choose-copy', destination),
  finishPdfCopy: data => ipcRenderer.invoke('test:finish-copy', data),
  statPdf: async () => ({mtimeMs:1,size:1}), saveSession: async () => {}, closePdf: async () => {},
  openPdfDialog: async () => [], getPathForFile: () => '', confirmWindowClose: () => {},
  onOpenRequested: () => () => {}, onCommand: (name,cb) => {commands.set(name,cb);return () => commands.delete(name)}
})
contextBridge.exposeInMainWorld('testCommands',{run:name => commands.get(name)?.()})`
)
let savedPdf
let exportedPdf
let saveFailure = null
let cancelExport = false
let saveCount = 0
ipcMain.handle('test:choose-copy', (_, destination) => {
  if (cancelExport) return null
  assert.ok(destination.excludedPaths.includes('multi.pdf'))
  return 'export.pdf'
})
ipcMain.handle('test:finish-copy', (_, data) => {
  if (data) exportedPdf = data
})
ipcMain.handle('test:save', (_, payload) => {
  if (saveFailure) throw new Error(saveFailure)
  saveCount++
  savedPdf = payload.data
  return { mtimeMs: 1, size: savedPdf.byteLength }
})
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
  while (!(await (typeof code === 'function' ? code() : evaluate(code)))) {
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
    const thumbnailsReady = () =>
      waitFor(`(() => {
      const canvases = [...document.querySelectorAll('[aria-label^="Go to page"] canvas')];
      return canvases.length === 2 && canvases.every(c => c.width > 0 && c.getContext('2d').getImageData(10,10,1,1).data[3] === 255);
    })()`)
    const closed = () => waitFor(`document.querySelector('[role="dialog"]') === null`)
    await waitFor(`document.querySelector('.visible .pdfViewer .page canvas')?.width > 0`)
    await waitFor(`document.querySelector('.visible .freeTextEditor .internal') !== null`)
    await evaluate(`(() => {
      const input = document.querySelector('.visible .freeTextEditor .internal');
      input.innerText = 'Edited page note';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
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
    await thumbnailsReady()
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
      `Array.from(document.querySelectorAll('[role="tabpanel"] button')).find(el=>el.querySelector('[data-slot="outline-title"]')?.textContent==='Chapter one').click()`
    )
    await closed()
    await waitFor(`document.querySelector('[aria-label="Current page"]').value === '1'`)
    await openNavigation()
    await waitFor(
      `document.querySelector('[role="tab"][aria-selected="true"]').textContent === 'Outline'`
    )
    await evaluate(`document.querySelector('[aria-label="Toggle section: Chapter one"]').click()`)
    await evaluate(
      `Array.from(document.querySelectorAll('[role="tabpanel"] button')).find(el=>el.querySelector('[data-slot="outline-title"]')?.textContent==='Section two').click()`
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
    await openNavigation()
    await clickTab('Pages')
    const pagePixels = (selector) =>
      evaluate(
        `Array.from(document.querySelector(${JSON.stringify(selector)}).getContext('2d').getImageData(10,10,1,1).data)`
      )
    const dragPage = async (from, to, label = 'Go to', groupSize = 1, cancel = false) => {
      if (label === 'Go to') await thumbnailsReady()
      await waitFor(
        `(() => { const c = document.querySelector('[aria-label="${label} page ${from}"] canvas'); return c?.width > 0 && c.getContext('2d').getImageData(10,10,1,1).data[3] === 255 })()`
      )
      const initialPixels = await pagePixels(`[aria-label="${label} page ${from}"] canvas`)
      const [start, end] = await evaluate(`['${from}', '${to}'].map(number => {
        const r = document.querySelector('[aria-label="${label} page ' + number + '"]').getBoundingClientRect();
        return {x: Math.round(r.x + r.width * (number === '${to}' ? (${to} > ${from} ? 0.75 : 0.25) : 0.5)), y: Math.round(r.y + r.height / 2)};
      })`)
      win.webContents.sendInputEvent({ type: 'mouseMove', ...start })
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...start })
      let animatedPages = false
      for (let step = 1; step <= 12; step++) {
        win.webContents.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(start.x + ((end.x - start.x) * step) / 12),
          y: Math.round(start.y + ((end.y - start.y) * step) / 12)
        })
        await new Promise((resolve) => setTimeout(resolve, 30))
        animatedPages ||= await evaluate(
          `Array.from(document.querySelectorAll('[aria-label="PDF pages"] [data-page-id]:not([aria-hidden="true"])')).some(card => card.getAnimations().some(animation => animation.effect?.getKeyframes().some(frame => frame.translate || frame.transform)))`
        )
      }
      if (!cancel)
        assert.ok(animatedPages, 'Remaining pages animate smoothly when the insertion cell moves')
      assert.ok(
        await evaluate(`(() => {
        const slot = document.querySelector('[data-page-drop-slot]');
        const style = getComputedStyle(slot);
        return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.borderTopWidth === '0px' && style.borderRightWidth === '0px' && style.borderBottomWidth === '0px' && style.borderLeftWidth === '0px';
      })()`),
        'The insertion cell is empty, without a border or background fill'
      )
      if (groupSize > 1) {
        assert.equal(
          await evaluate(
            `document.querySelector('[aria-label="Moving ${groupSize} pages"]')?.querySelectorAll('canvas').length ?? 0`
          ),
          Math.min(groupSize, 4),
          'All selected pages follow the pointer together'
        )
        assert.ok(
          await evaluate(`(() => {
          const cards = [...document.querySelector('[aria-label="Moving ${groupSize} pages"]').querySelectorAll('canvas')].map(canvas => canvas.parentElement);
          const rotations = cards.map(card => new DOMMatrix(getComputedStyle(card).transform).b);
          return rotations[0] < 0 && rotations.at(-1) > 0;
        })()`),
          'Dragged pages fan out around the bottom of the cards'
        )
        assert.ok(
          await evaluate(`(() => {
          const originals = [...document.querySelector('[aria-label="PDF pages"]').querySelectorAll('[data-page-id][aria-selected="true"]')];
          return originals.length >= ${groupSize} && originals.every(card => !card.getClientRects().length || getComputedStyle(card).opacity === '0');
        })()`),
          'Dragged pages disappear from the grid until they are dropped'
        )
        assert.ok(
          await evaluate(`(() => {
          const grid = document.querySelector('[aria-label="PDF pages"]');
          const cells = [...grid.children].filter(cell => getComputedStyle(cell).position !== 'absolute' && getComputedStyle(cell).display !== 'none');
          return grid.querySelectorAll('[data-page-drop-slot]').length === 1 && cells.length === grid.querySelectorAll('[data-page-id]').length - ${groupSize} + 1;
        })()`),
          'The compact grid contains only remaining pages and one insertion cell'
        )
        if (groupSize === 10)
          assert.ok(
            await evaluate(`(() => {
          const scroll = document.querySelector('[data-page-scroll]');
          return scroll.scrollHeight <= scroll.clientHeight + 2;
        })()`),
            'Hidden dragged pages do not leave a scrollable white area'
          )
      }
      assert.deepEqual(
        await evaluate(`(() => {
        const canvas = [...document.querySelectorAll('[data-dnd-overlay] canvas')].at(-1);
        return Array.from(canvas.getContext('2d').getImageData(10,10,1,1).data);
      })()`),
        initialPixels,
        'The frozen drag preview retains its page content before release'
      )
      if (cancel) {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      }
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end })
      if (cancel) {
        await waitFor(`document.querySelector('[data-page-drop-slot]') === null`)
        return
      }

      await waitFor(
        `Array.from(document.querySelectorAll('[role="dialog"] button')).some(el => el.textContent === 'Save changes' && !el.disabled)`
      )
    }
    await dragPage(1, 2)
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="Current page"]').value`),
      '2',
      'Draft reorder does not mutate the viewer'
    )
    assert.equal(saveCount, 0, 'Draft reorder does not write the file')
    await thumbnailsReady()
    assert.deepEqual(
      (await pagePixels('[aria-label="Go to page 1"] canvas')).slice(0, 3),
      [0, 0, 255]
    )
    await evaluate(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(el => el.textContent === 'Save changes').click()`
    )
    await waitFor(() => savedPdf)
    await waitFor(`document.querySelector('[aria-label="Current page"]').value === '1'`)
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const savedTask = getDocument({ data: new Uint8Array(savedPdf) })
    try {
      const saved = await savedTask.promise
      assert.equal(saved.numPages, 2)
      assert.equal((await saved.getPage(1)).getViewport({ scale: 1 }).width, 792)
      assert.equal(
        (await (await saved.getPage(2)).getAnnotations())[0].contentsObj.str,
        'Edited page note'
      )
      assert.equal((await saved.getOutline())[0].title, 'Chapter one')
    } finally {
      await savedTask.destroy()
    }
    await dragPage(2, 1)
    await evaluate(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(el => el.textContent === 'Save changes').click()`
    )
    await waitFor(`document.querySelector('[aria-label="Current page"]').value === '2'`)
    await thumbnailsReady()
    assert.deepEqual(
      (await pagePixels('[aria-label="Go to page 1"] canvas')).slice(0, 3),
      [255, 0, 0]
    )
    await evaluate(`document.querySelector('[aria-label="Go to page 2"]').click()`)
    await closed()
    console.log(
      'PASS: dragging pages in both directions updates the PDF, preserves selection and saves the new order'
    )
    await evaluate(`window.testCommands.run('previous-tab')`)
    await waitFor(
      `document.querySelector('[aria-label="empty.pdf"]').getAttribute('aria-pressed') === 'true'`
    )
    await openNavigation()
    await clickTab('Outline')
    await waitFor(
      `document.querySelector('[role="tabpanel"]').textContent.includes('No outline available')`
    )
    await clickTab('Pages')
    await waitFor(`document.querySelectorAll('[aria-label^="Go to page"]').length === 1`)
    console.log('PASS: navigation shows the active document and handles PDFs without an outline')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await closed()
    await evaluate(`window.testCommands.run('previous-tab')`)
    await waitFor(
      `document.querySelector('[aria-label="multi.pdf"]').getAttribute('aria-pressed') === 'true'`
    )
    await waitFor(`document.querySelector('.visible .pdfViewer .page canvas')?.width > 0`)
    await openNavigation()
    const button = (text, role = 'dialog') =>
      evaluate(
        `Array.from(document.querySelectorAll('[role="${role}"] button')).find(el => el.textContent === ${JSON.stringify(text)}).click()`
      )
    const select = (number, shift = false) =>
      evaluate(
        `document.querySelector('[aria-label="Select page ${number}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: ${shift} }))`
      )
    const selectMode = () => button('Select pages')
    const selectedCount = () =>
      evaluate(
        `document.querySelectorAll('[aria-label^="Select page"][aria-selected="true"]').length`
      )
    const widths = async (data) => {
      const task = getDocument({ data: new Uint8Array(data) })
      try {
        const doc = await task.promise
        return await Promise.all(
          Array.from(
            { length: doc.numPages },
            async (_, i) => (await doc.getPage(i + 1)).getViewport({ scale: 1 }).width
          )
        )
      } finally {
        await task.destroy()
      }
    }
    await selectMode()
    assert.equal(await selectedCount(), 0)
    await select(2)
    await waitFor(
      `document.querySelectorAll('[aria-label^="Select page"][aria-selected="true"]').length === 1`
    )
    await select(4, true)
    await waitFor(
      `document.querySelectorAll('[aria-label^="Select page"][aria-selected="true"]').length === 3`
    )
    assert.equal(await selectedCount(), 3, 'Shift selects an interval')
    await evaluate(
      `document.querySelector('[aria-label="Select page 2"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true }))`
    )
    assert.equal(
      await selectedCount(),
      5,
      'Command-A selects all pages while the app shortcuts are blocked'
    )
    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll('[role="dialog"] button')).find(el => el.textContent === 'Delete').disabled`
      ),
      true
    )
    await button('Done')
    await selectMode()
    await select(2)
    await select(4)
    await dragPage(2, 1, 'Select', 2)
    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll('[role="dialog"] button')).some(el => el.textContent === 'Move')`
      ),
      false
    )
    assert.equal(await selectedCount(), 2, 'Moving keeps the same pages selected')
    const beforeExport = saveCount
    cancelExport = true
    await button('Export')
    await waitFor(
      `!document.querySelector('[aria-label="PDF pages"]').getAttribute('aria-busy') || document.querySelector('[aria-label="PDF pages"]').getAttribute('aria-busy') === 'false'`
    )
    assert.equal(exportedPdf, undefined)
    assert.equal(await selectedCount(), 2, 'Cancelling export keeps the selection')
    cancelExport = false
    await button('Export')
    await waitFor(() => exportedPdf)
    assert.deepEqual(await widths(exportedPdf), [550, 650], 'Export uses the draft order')
    assert.equal(saveCount, beforeExport, 'Export leaves the original PDF unchanged')
    await button('Select all')
    exportedPdf = undefined
    await button('Export')
    await waitFor(() => exportedPdf)
    assert.deepEqual(
      await widths(exportedPdf),
      [550, 650, 500, 600, 700],
      'Export preserves the complete draft permutation'
    )
    await button('Done')
    await selectMode()
    await select(1)
    await select(2)

    await button('Delete')
    await waitFor(`document.querySelector('[role="alertdialog"]') !== null`)
    assert.equal(
      await evaluate(`document.querySelectorAll('[aria-label^="Select page"]').length`),
      5
    )
    await button('Cancel', 'alertdialog')
    await button('Delete')
    await button('Delete pages', 'alertdialog')
    await waitFor(`document.querySelectorAll('[aria-label^="Select page"]').length === 3`)
    assert.equal(await selectedCount(), 0)
    await button('Discard page changes')
    await button('Discard page changes', 'alertdialog')
    await waitFor(`document.querySelectorAll('[aria-label^="Select page"]').length === 5`)
    await select(1)
    await button('Delete')
    await button('Delete page', 'alertdialog')
    await button('Done')
    await evaluate(`document.querySelector('[aria-label="Go to page 1"]').click()`)
    await waitFor(`document.querySelector('[role="alertdialog"]') !== null`)
    await button('Continue editing', 'alertdialog')
    assert.ok(await evaluate(`document.querySelector('[role="dialog"]') !== null`))
    saveFailure = 'SIMULATED_WRITE_FAILURE'
    await button('Save changes')
    await waitFor(
      `document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('not saved')`
    )
    assert.equal(
      await evaluate(`document.querySelectorAll('[aria-label^="Go to page"]').length`),
      4,
      'Write errors retain the draft'
    )
    assert.equal(await evaluate(`document.querySelector('[aria-label="Current page"]').value`), '1')
    saveFailure = null
    await evaluate(`document.querySelector('[aria-label="Go to page 1"]').click()`)
    const saves = saveCount
    await button('Save changes', 'alertdialog')
    await waitFor(() => saveCount > saves)
    await closed()
    assert.deepEqual(await widths(savedPdf), [550, 600, 650, 700])
    await openNavigation()
    await selectMode()
    await select(4)
    await button('Delete')
    await button('Delete page', 'alertdialog')
    await waitFor(`document.querySelector('[role="alertdialog"]') === null`)
    await evaluate(`void window.testCommands.run('window-close-requested')`)
    await waitFor(
      `Array.from(document.querySelectorAll('[role="alertdialog"] button')).some(el => el.textContent === 'Continue editing')`
    )
    await button('Continue editing', 'alertdialog')
    await waitFor(`document.querySelector('[role="alertdialog"]') === null`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await waitFor(`document.querySelector('[role="alertdialog"]') !== null`)
    await button('Discard', 'alertdialog')
    await closed()
    console.log(
      'PASS: selection, range and select-all; group move; export/cancel; delete confirmation; reset; guarded exit; write failure and atomic save'
    )
    await openNavigation()
    await selectMode()
    await select(4)
    await button('Delete')
    await button('Delete page', 'alertdialog')
    await waitFor(`document.querySelector('[role="alertdialog"]') === null`)
    saveFailure = 'FILE_CHANGED_EXTERNALLY'
    await button('Save changes')
    await waitFor(
      `Array.from(document.querySelectorAll('[role="dialog"]')).some(el => el.textContent.includes('The original file is unavailable or changed'))`
    )
    exportedPdf = undefined
    await button('Save as copy')
    await waitFor(() => exportedPdf)
    await waitFor(
      `document.querySelector('[aria-label="export.pdf"]')?.getAttribute('aria-pressed') === 'true'`
    )
    assert.deepEqual(
      await widths(exportedPdf),
      [550, 600, 650],
      'Conflict copies include the page draft'
    )
    assert.deepEqual(
      await widths(savedPdf),
      [550, 600, 650, 700],
      'Conflict leaves the original unchanged'
    )
    saveFailure = null
    console.log('PASS: window-close guard and conflict Save as copy preserve the page draft')
    await waitFor(`document.querySelectorAll('[aria-label^="Go to page"]').length === 3`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await closed()
    await evaluate(`window.testCommands.run('previous-tab')`)
    await waitFor(
      `document.querySelector('[aria-label="many.pdf"]')?.getAttribute('aria-pressed') === 'true'`
    )
    await openNavigation()
    await selectMode()
    await select(1)
    await select(10, true)
    await waitFor(
      `document.querySelectorAll('[aria-label^="Select page"][aria-selected="true"]').length === 10`
    )
    await dragPage(1, 2, 'Select', 10, true)
    assert.equal(await evaluate(`document.querySelectorAll('[data-page-id]').length`), 12)
    assert.equal(
      await evaluate(`document.querySelectorAll('[data-page-id][aria-hidden="true"]').length`),
      0
    )
    console.log(
      'PASS: ten dragged pages collapse into one insertion cell; cancel restores every page'
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
