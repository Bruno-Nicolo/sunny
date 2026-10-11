import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'

const root = resolve(import.meta.dirname, '..')
const temp = await mkdtemp(join(tmpdir(), 'lepis-quit-'))
try {
  const harness = join(temp, 'quit.cjs')
  await writeFile(
    harness,
    `
const { app, BrowserWindow } = require('electron')
require(${JSON.stringify(join(root, 'out/main/index.js'))})
app.setPath('userData', ${JSON.stringify(temp)})
app.whenReady().then(() => {
  const window = BrowserWindow.getAllWindows()[0]
  window.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      const mode = process.argv[2]
      if (mode !== 'quit') {
        if (mode === 'cancel-then-close') {
          const send = window.webContents.send.bind(window.webContents)
          window.webContents.send = () => {}
          app.quit()
          window.webContents.send = send
        }
        window.once('closed', () => {
          setTimeout(() => {
            if (BrowserWindow.getAllWindows().length !== 0) return app.exit(3)
            console.log('PASS: closing the window leaves macOS app running')
            app.emit('activate')
            const reopened = BrowserWindow.getAllWindows()[0]
            reopened.webContents.once('did-finish-load', () => setTimeout(() => app.quit(), 500))
          }, 200)
        })
        window.close()
      } else app.quit()
      setTimeout(() => {
        console.error('FAIL: app remains alive after one quit; windows=' + BrowserWindow.getAllWindows().length)
        app.exit(1)
      }, 3000)
    }, 500)
  })
})
setTimeout(() => app.exit(2), 10000)
`
  )
  for (const mode of ['quit', 'close-then-quit', 'cancel-then-close']) {
    const child = spawn(electron, [harness, mode], { cwd: root, stdio: 'inherit' })
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    assert.equal(code, 0, `${mode}: one quit must terminate the process`)
    console.log(`PASS: ${mode} terminates the application process`)
  }
} finally {
  await rm(temp, { recursive: true, force: true })
}
