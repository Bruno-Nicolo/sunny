import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { app, BrowserWindow } = electron
const root = path.resolve(import.meta.dirname, '..')
let window
let dispose
const htmlPath = path.join(root, 'out', `math-layout-${process.pid}.html`)
async function main() {
  try {
    await app.whenReady()
    const markdown = await import('./fixtures/chat-markdown.mjs')
    const { render } = markdown
    dispose = markdown.dispose
    window = new BrowserWindow({ show: false, width: 800, height: 700 })
    const styles = fs
      .readdirSync(path.join(root, 'out/renderer/assets'))
      .filter((name) => name.endsWith('.css'))
      .map(
        (name) =>
          `<link rel="stylesheet" href="${pathToFileURL(path.join(root, 'out/renderer/assets', name))}">`
      )
      .join('')
    const formula = String.raw`\operatorname{Var}(X) = E[X^2] - 2E[X]E[X] + E[X]^2 = E[X^2] - E[X]^2.`
    fs.writeFileSync(
      htmlPath,
      `<!doctype html><html><head>${styles}</head><body>
    <div style="width:340px;--chat-font-size:20px" class="p-4">
      ${render(`\\[${formula}\\]`)}
      ${render(String.raw`\[\sum_{i=1}^{n} \frac{x_i^2}{\sqrt{1+x_i}} = \int_0^1 t^2 \, dt\]`)}
    </div>
  </body></html>`
    )
    await window.loadFile(htmlPath)
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    for (const size of [12, 14, 20, 24]) {
      for (const width of [300, 500]) {
        await window.webContents.executeJavaScript(`(() => {
          const container = document.querySelector('body > div')
          container.style.setProperty('--chat-font-size', '${size}px')
          container.style.width = '${width}px'
        })()`)
        const measurements = await window.webContents
          .executeJavaScript(`Array.from(document.querySelectorAll('.katex-display')).map((display) => {
    const bounds = display.getBoundingClientRect()
    const script = display.querySelector('.msupsub .sizing')
    const scriptRatio = script
      ? parseFloat(getComputedStyle(script).fontSize) / parseFloat(getComputedStyle(display.querySelector('.katex')).fontSize)
      : null
    const walker = document.createTreeWalker(display.querySelector('.katex-html'), NodeFilter.SHOW_TEXT)
    const clipped = []
    let minLeft = Infinity
    let maxRight = -Infinity
    let lastRange
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const rect = range.getBoundingClientRect()
      minLeft = Math.min(minLeft, rect.left)
      maxRight = Math.max(maxRight, rect.right)
      lastRange = range
      if (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) {
        clipped.push({ text: node.textContent, top: rect.top, bottom: rect.bottom, font: getComputedStyle(node.parentElement).fontSize, classes: node.parentElement.parentElement.className })
      }
    }
    display.scrollLeft = display.scrollWidth
    const lastRightAfterScroll = lastRange.getBoundingClientRect().right
    const scrollLeft = display.scrollLeft
    display.scrollLeft = 0
    return { scriptRatio, lastRightAfterScroll, scrollLeft, top: bounds.top, bottom: bounds.bottom, clipped,
      clientWidth: display.clientWidth, scrollWidth: display.scrollWidth,
      left: bounds.left, right: bounds.right, minLeft, maxRight,
      fontSize: getComputedStyle(display).fontSize }
  })`)
        assert.ok(
          Math.abs(measurements[0].scriptRatio - 0.7) < 0.01,
          'superscripts use the KaTeX script font size'
        )
        for (const measured of measurements) {
          assert.deepEqual(measured.clipped, [], `clipped formula at ${size}px / ${width}px`)
          assert.ok(measured.minLeft >= measured.left - 1, 'formula start remains reachable')
          assert.ok(
            measured.lastRightAfterScroll <= measured.right + 1,
            'formula end is reachable by horizontal scrolling'
          )
          if (measured.scrollWidth > measured.clientWidth) assert.ok(measured.scrollLeft > 0)
        }
      }
    }
    console.log('PASS: formula layout preserves superscripts and allows horizontal scrolling')
  } finally {
    window?.destroy()
    fs.rmSync(htmlPath, { force: true })
    dispose?.()
    app.quit()
  }
}
main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
