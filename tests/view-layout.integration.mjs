import { enableTestFocus } from './fixtures/focus.mjs'
import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPdf } from './fixtures/pdf.mjs'

function createBlankPdf(pages) {
  return createPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pages} >>`,
    ...Array(pages).fill('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>')
  ])
}
const blankPdf = createBlankPdf(3)
const readingPdf = createBlankPdf(12)

const { app, BrowserWindow, ipcMain } = electron
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-view-layout-'))
app.setPath('userData', temp)

ipcMain.handle('test:read', (_, name) => ({
  path: name,
  name,
  directoryPath: 'test',
  source: {
    kind: 'memory',
    data: new Uint8Array(name === 'reading.pdf' ? readingPdf : blankPdf).buffer
  },
  mtimeMs: 1,
  size: blankPdf.length
}))
const preload = path.join(temp, 'preload.cjs')
fs.writeFileSync(
  preload,
  `
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('lepis', {
  releasePdfSource: async () => {},
  loadDrafts: async () => [], saveDraft: async () => {}, deleteDraft: async () => {},
  setTheme: () => {},
  loadSession: async () => ({ tabs: ['other.pdf','layout.pdf','reading.pdf'].map(path => ({path,page:1,scale:path === 'reading.pdf' ? '1' : 'page-fit',scrollTop:0})), activePath:'layout.pdf', highlightColor:'#FDE047', theme:'light' }),
  readPdf: path => ipcRenderer.invoke('test:read',path),
  statPdf: async () => ({mtimeMs:1,size:1}), saveSession: async () => {}, closePdf: async () => {},
  openPdfDialog: async () => [], getPathForFile: () => '', confirmWindowClose: () => {},
  onOpenRequested: () => () => {},
  onCommand: (command, callback) => {
    const channel = 'menu:' + command
    const listener = () => callback()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
})`
)
let win
const evaluate = (code) => win.webContents.executeJavaScript(code)
async function waitFor(code, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (!(await evaluate(code))) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${code}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
const command = (id) => win.webContents.send(`menu:${id}`)
async function openViewMenu() {
  await evaluate(`(() => {
    const button = document.querySelector('[aria-label="PDF view"]')
    button.focus()
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  })()`)
  await waitFor(`document.querySelector('[role="menuitemcheckbox"]') !== null`)
}
const clickViewItem = (role) => evaluate(`document.querySelector('[role="${role}"]').click()`)
const orientation = () =>
  evaluate(`(() => {
    const page = document.querySelector('.visible .page').getBoundingClientRect()
    return page.width > page.height ? 'landscape' : 'portrait'
  })()`)
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
    await waitFor(`document.querySelector('.visible .pdfViewer .page canvas')?.width > 0`)
    for (const selector of [
      '[aria-label="Toggle PDF navigation"]',
      '[aria-label="layout.pdf"]',
      '.visible .pdf-viewer-container'
    ]) {
      await evaluate(`document.querySelector('${selector}').focus()`)
      const initialScrollTop = await evaluate(
        `document.querySelector('.visible .pdf-viewer-container').scrollTop`
      )
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' })
      await waitFor(
        `document.querySelector('.visible .pdf-viewer-container').scrollTop === ${initialScrollTop + 40}`,
        1500
      )
      assert.equal(
        await evaluate(`document.activeElement === document.querySelector('${selector}')`),
        true,
        'Scrolling must preserve keyboard focus'
      )
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' })
      await waitFor(
        `document.querySelector('.visible .pdf-viewer-container').scrollTop === ${initialScrollTop}`,
        1500
      )
    }
    assert.equal(
      await evaluate(`document.querySelector('.invisible .pdf-viewer-container')?.scrollTop ?? 0`),
      0,
      'Scrolling must only affect the active PDF'
    )
    for (const key of ['ArrowUp', 'ArrowDown']) {
      assert.equal(
        await evaluate(`(() => {
          const input = document.querySelector('[aria-label="Current page"]')
          input.focus()
          const event = new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true })
          input.dispatchEvent(event)
          return event.defaultPrevented
        })()`),
        false,
        'Arrow keys must retain their normal behavior in text inputs'
      )
    }
    assert.equal(await orientation(), 'portrait')
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="PDF view"]') !== null && document.querySelector('[role="menu"]') === null`
      ),
      true,
      'View commands must be grouped in a dedicated toolbar menu'
    )
    await openViewMenu()
    assert.equal(
      await evaluate(`new Set([...document.querySelectorAll(
        '[role="menuitem"] > svg, [role="menuitemcheckbox"] > svg'
      )].map(icon => getComputedStyle(icon).color)).size`),
      1,
      'All PDF view menu entry icons must use the same color'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[role="menuitemcheckbox"]').getAttribute('aria-checked')`
      ),
      'false'
    )
    await clickViewItem('menuitem')
    await waitFor(
      `document.querySelector('.visible .page').getBoundingClientRect().width > document.querySelector('.visible .page').getBoundingClientRect().height`
    )
    for (let i = 0; i < 3; i++) {
      command('rotate-clockwise')
      await waitFor(
        `document.querySelector('.visible .page').getBoundingClientRect().width ${i === 1 ? '>' : '<'} document.querySelector('.visible .page').getBoundingClientRect().height`
      )
    }
    await evaluate(`(() => {
      const input = document.querySelector('[aria-label="Current page"]')
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }))
    })()`)
    assert.equal(await orientation(), 'portrait', 'Typing r in an input must not rotate the PDF')
    await evaluate(`document.activeElement.blur()`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'R' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'R' })
    await waitFor(
      `document.querySelector('.visible .page').getBoundingClientRect().width > document.querySelector('.visible .page').getBoundingClientRect().height`
    )
    const landscape = await evaluate(`(() => {
      const page = document.querySelector('.visible .page').getBoundingClientRect()
      return page.width > page.height
    })()`)
    assert.ok(landscape, 'Rotation must change page geometry')
    for (let i = 0; i < 3; i++) {
      command('rotate-clockwise')
      await waitFor(
        `document.querySelector('.visible .page').getBoundingClientRect().width ${i === 1 ? '>' : '<'} document.querySelector('.visible .page').getBoundingClientRect().height`
      )
    }
    assert.equal(
      await orientation(),
      'portrait',
      'Four rotations must return to the original orientation'
    )

    await openViewMenu()
    await clickViewItem('menuitemcheckbox')
    await waitFor(`document.querySelector('.visible .spread')?.children.length === 2`)

    const layout = await evaluate(`(() => {
      const spreads = document.querySelectorAll('.visible .spread')
      const [first, second] = [...spreads[0].children].map(page => page.getBoundingClientRect())
      const container = document.querySelector('.visible .pdf-viewer-container')
      return {
        counts: [...spreads].map(spread => spread.children.length),
        aligned: Math.abs(first.top - second.top) < 1,
        separated: second.left > first.right,
        fits: container.scrollWidth <= container.clientWidth + 1
      }
    })()`)
    assert.deepEqual(layout.counts, [2, 1], 'An odd final page must remain visible')
    assert.ok(layout.aligned && layout.separated, 'Pages must sit side by side with a gap')
    assert.ok(layout.fits, 'Fit page must fit both pages in the viewer width')
    command('rotate-clockwise')
    await waitFor(
      `document.querySelector('.visible .page').getBoundingClientRect().width > document.querySelector('.visible .page').getBoundingClientRect().height`
    )
    assert.equal(await orientation(), 'landscape', 'Rotation must also work in two-page view')

    await evaluate(`document.querySelector('[aria-label="other.pdf"]').click()`)
    await waitFor(
      `document.querySelector('.visible .page canvas')?.width > 0 && document.querySelectorAll('.visible .spread').length === 0`
    )
    assert.equal(await orientation(), 'portrait', 'Other tabs must keep their own rotation')
    await evaluate(`document.querySelector('[aria-label="layout.pdf"]').click()`)
    await waitFor(`document.querySelector('.visible .spread')?.children.length === 2`)
    assert.equal(await orientation(), 'landscape', 'Switching tabs must preserve rotation')
    await openViewMenu()
    assert.equal(
      await evaluate(
        `document.querySelector('[role="menuitemcheckbox"]').getAttribute('aria-checked')`
      ),
      'true',
      'The view menu must reflect the active tab layout'
    )
    await clickViewItem('menuitemcheckbox')
    await waitFor(`document.querySelectorAll('.visible .spread').length === 0`)
    assert.equal(
      await evaluate(`document.querySelectorAll('.visible .pdfViewer > .page').length`),
      3
    )

    command('toggle-two-page-view')
    await waitFor(`document.querySelector('.visible .spread')?.children.length === 2`)
    command('zoom-in')
    await new Promise((resolve) => setTimeout(resolve, 100))
    const readingZoom = await evaluate(`document.querySelector('button.min-w-16').textContent`)
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="Presentation mode"]')`),
      null,
      'Presentation must be inside the PDF view dropdown'
    )
    await openViewMenu()
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Presentation mode').click()`,
      true
    )
    await waitFor(`document.fullscreenElement?.classList.contains('pdf-viewer-container')`)
    await waitFor(`document.querySelectorAll('.visible .pdfViewer .page').length === 1`)
    assert.equal(
      await evaluate(`getComputedStyle(document.fullscreenElement).overflow`),
      'hidden',
      'Presentation must hide scrolling'
    )
    await evaluate(`document.fullscreenElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true, cancelable: true
    }))`)
    await waitFor(`document.querySelector('.visible .pdfViewer .page')?.dataset.pageNumber === '2'`)
    await evaluate(`document.fullscreenElement.click()`)
    await waitFor(`document.querySelector('.visible .pdfViewer .page')?.dataset.pageNumber === '3'`)
    await evaluate(`document.fullscreenElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowLeft', bubbles: true, cancelable: true
    }))`)
    await waitFor(`document.querySelector('.visible .pdfViewer .page')?.dataset.pageNumber === '2'`)
    await evaluate(`document.fullscreenElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true
    }))`)
    await waitFor(`document.fullscreenElement === null`)
    await waitFor(`document.querySelector('.visible .spread')?.children.length === 2`)
    await waitFor(
      `document.querySelector('button.min-w-16').textContent === ${JSON.stringify(readingZoom)}`
    )
    assert.ok(
      await evaluate(`(() => {
        const page = document.querySelector('.visible .page[data-page-number="2"]').getBoundingClientRect()
        const container = document.querySelector('.visible .pdf-viewer-container').getBoundingClientRect()
        return page.bottom > container.top && page.top < container.bottom
      })()`),
      'Leaving presentation must keep the last slide visible and restore paired pages'
    )

    await evaluate(`document.querySelector('[aria-label="reading.pdf"]').click()`)
    await waitFor(`document.querySelector('.visible .page canvas')?.width > 0`)
    for (const mode of ['fixed', 'paired', 'fit']) {
      if (mode === 'paired') {
        command('toggle-two-page-view')
        await waitFor(`document.querySelector('.visible .spread')?.children.length === 2`)
      } else if (mode === 'fit') {
        await evaluate(`document.querySelector('button.min-w-16').click()`)
        await waitFor(
          `[...document.querySelectorAll('button')].some(button => button.textContent === 'Fit page')`
        )
        await evaluate(
          `[...document.querySelectorAll('button')].find(button => button.textContent === 'Fit page').click()`
        )
        await evaluate(
          `document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))`
        )
      }
      await evaluate(
        `document.querySelector('.visible .page[data-page-number="9"]').scrollIntoView({block:'start'})`
      )
      await waitFor(`document.querySelector('[aria-label="Current page"]').value === '9'`)
      for (let rotation = 0; rotation < 4; rotation++) {
        command('rotate-clockwise')
        await waitFor(
          `document.querySelector('.visible .page').getBoundingClientRect().width ${rotation % 2 === 0 ? '>' : '<'} document.querySelector('.visible .page').getBoundingClientRect().height`
        )
        await evaluate(
          `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
        )
        assert.equal(
          await evaluate(`document.querySelector('[aria-label="Current page"]').value`),
          '9',
          'Rotating must preserve the current page after the layout settles'
        )
        assert.ok(
          await evaluate(`(() => {
          const page = document.querySelector('.visible .page[data-page-number="9"]').getBoundingClientRect()
          const container = document.querySelector('.visible .pdf-viewer-container').getBoundingClientRect()
          return page.bottom > container.top && page.top < container.bottom
        })()`),
          'The page being read must remain visible after rotation'
        )
      }
    }

    console.log(
      'PASS: view menu, scrolling, input guards, rotation, paired pages, fit scale, reading position after rotation, tab isolation, and fullscreen presentation with layout restoration'
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
