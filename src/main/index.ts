import { app, BrowserWindow, protocol } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { createPdfResponse, releaseAllPdfSources } from './pdf-sources'
import { createMenu } from './menu'
import { createWindow, getMainWindow, sendToRenderer } from './window'
import icon from '../../resources/icon.png?asset'

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

const pendingFiles: string[] = []

app.setName('Sunny')
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'Sunny Development'))
}

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
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon)
  electronApp.setAppUserModelId('app.sunny.desktop')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  protocol.handle('lepis-pdf', createPdfResponse)
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
  void releaseAllPdfSources()
  if (process.platform !== 'darwin') app.quit()
})
