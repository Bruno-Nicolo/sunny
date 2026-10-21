import { join } from 'path'
import { app, BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'

let mainWindow: BrowserWindow | null = null
let allowWindowClose = false
let quitRequested = false

app.on('before-quit', (event) => {
  if (!mainWindow || allowWindowClose) return
  event.preventDefault()
  quitRequested = true
  sendToRenderer('window:close-requested')
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

export function confirmWindowClose(): void {
  allowWindowClose = true
  if (quitRequested) app.quit()
  else mainWindow?.close()
}

export function createWindow(): BrowserWindow {
  allowWindowClose = false
  quitRequested = false
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Lepis',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 17 },
    backgroundColor: '#f4f4f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (event) => {
    if (allowWindowClose) return
    event.preventDefault()
    quitRequested = false
    sendToRenderer('window:close-requested')
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev) {
    mainWindow.webContents.on('console-message', (details) => {
      console.log(`[renderer:${details.level}] ${details.message}`)
    })
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}
