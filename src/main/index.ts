import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { createMenu } from './menu'
import { createWindow, getMainWindow, sendToRenderer } from './window'

const pendingFiles: string[] = []

app.setName('Lepis')

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()

app.on('second-instance', (_event, argv) => {
  const pdfPath = argv.find((arg) => arg.toLowerCase().endsWith('.pdf'))
  if (pdfPath) sendToRenderer('file:open-requested', pdfPath)
  getMainWindow()?.show()
  getMainWindow()?.focus()
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (getMainWindow()) sendToRenderer('file:open-requested', filePath)
  else pendingFiles.push(filePath)
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('app.lepis.desktop')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerIpc()
  createMenu()
  const window = createWindow()
  window.webContents.once('did-finish-load', () => {
    for (const filePath of pendingFiles.splice(0)) sendToRenderer('file:open-requested', filePath)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
