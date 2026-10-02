import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { shortcuts, type ShortcutCommand } from '../shared/shortcuts'

type SessionTab = {
  path: string
  page: number
  scale: string
  scrollTop: number
}

type SessionState = {
  activePath: string | null
  tabs: SessionTab[]
  highlightColor: string
  theme: 'system' | 'light' | 'dark'
}

type OpenedPdf = {
  path: string
  name: string
  directoryName: string
  data: Uint8Array
  mtimeMs: number
  size: number
}

const defaultSession: SessionState = {
  activePath: null,
  tabs: [],
  highlightColor: '#fde047',
  theme: 'system'
}

let mainWindow: BrowserWindow | null = null
let allowWindowClose = false
const pendingFiles: string[] = []

app.setName('Lepis')

function sessionPath(): string {
  return join(app.getPath('userData'), 'session.json')
}

function backupPath(tabId: string): string {
  const id = createHash('sha256').update(tabId).digest('hex')
  return join(app.getPath('userData'), 'backups', `${id}.pdf`)
}

async function readPdf(filePath: string): Promise<OpenedPdf> {
  const [data, stats] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)])
  const header = data.subarray(0, 1024).toString('latin1')
  if (!header.includes('%PDF-')) throw new Error('The selected file is not a valid PDF.')

  return {
    path: filePath,
    name: basename(filePath),
    directoryName: basename(dirname(filePath)),
    data: new Uint8Array(data),
    mtimeMs: stats.mtimeMs,
    size: stats.size
  }
}

async function openPdfDialog(): Promise<OpenedPdf[]> {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF',
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled) return []
  return Promise.all(result.filePaths.map(readPdf))
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2))
  await fs.rename(tempPath, filePath)
}

async function savePdf({
  tabId,
  filePath,
  data,
  expectedMtimeMs
}: {
  tabId: string
  filePath: string
  data: Uint8Array
  expectedMtimeMs: number
}): Promise<{ mtimeMs: number; size: number }> {
  const current = await fs.stat(filePath)
  if (Math.abs(current.mtimeMs - expectedMtimeMs) > 1) {
    throw new Error('FILE_CHANGED_EXTERNALLY')
  }

  const bytes = Buffer.from(data)
  if (!bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
    throw new Error('PDF.js produced invalid document data.')
  }

  const copyPath = backupPath(tabId)
  await fs.mkdir(dirname(copyPath), { recursive: true })
  await fs.copyFile(filePath, copyPath)

  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(tempPath, bytes)
    const handle = await fs.open(tempPath, 'r')
    await handle.sync()
    await handle.close()
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true })
    throw error
  }

  const saved = await fs.stat(filePath)
  return { mtimeMs: saved.mtimeMs, size: saved.size }
}

async function savePdfAs({
  data,
  suggestedName
}: {
  data: Uint8Array
  suggestedName: string
}): Promise<OpenedPdf | null> {
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PDF as',
    defaultPath: suggestedName,
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return null

  const bytes = Buffer.from(data)
  if (!bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
    throw new Error('PDF.js produced invalid document data.')
  }
  const filePath = result.filePath.toLowerCase().endsWith('.pdf')
    ? result.filePath
    : `${result.filePath}.pdf`
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(tempPath, bytes)
    const handle = await fs.open(tempPath, 'r')
    await handle.sync()
    await handle.close()
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true })
    throw error
  }
  return readPdf(filePath)
}

async function deleteBackup(tabId: string): Promise<void> {
  await fs.rm(backupPath(tabId), { force: true })
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

function shortcutMenuItem(id: ShortcutCommand): Electron.MenuItemConstructorOptions {
  const shortcut = shortcuts.find((entry) => entry.id === id)!
  return {
    label: shortcut.label,
    accelerator: 'accelerator' in shortcut ? shortcut.accelerator : undefined,
    click: () => sendToRenderer(`menu:${id}`)
  }
}

function createMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Lepis',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        shortcutMenuItem('open'),
        shortcutMenuItem('save'),
        { type: 'separator' },
        shortcutMenuItem('close-tab')
      ]
    },
    {
      label: 'Edit',
      submenu: [
        shortcutMenuItem('undo'),
        shortcutMenuItem('redo'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        shortcutMenuItem('zoom-in'),
        shortcutMenuItem('zoom-out'),
        { type: 'separator' },
        shortcutMenuItem('previous-page'),
        shortcutMenuItem('next-page'),
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Tabs',
      submenu: [
        shortcutMenuItem('next-tab'),
        shortcutMenuItem('previous-tab'),
        { type: 'separator' },
        ...shortcuts
          .filter(({ id }) => /^tab-[1-9]$/.test(id))
          .map(({ id }) => shortcutMenuItem(id))
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] }
  ])
  Menu.setApplicationMenu(menu)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Lepis',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
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
}

function registerIpc(): void {
  ipcMain.handle('pdf:open-dialog', openPdfDialog)
  ipcMain.handle('pdf:read', (_event, filePath: string) => readPdf(filePath))
  ipcMain.handle('pdf:stat', async (_event, filePath: string) => {
    const stats = await fs.stat(filePath)
    return { mtimeMs: stats.mtimeMs, size: stats.size }
  })
  ipcMain.handle('pdf:save', (_event, payload) => savePdf(payload))
  ipcMain.handle('pdf:save-as', (_event, payload) => savePdfAs(payload))
  ipcMain.handle('pdf:close', (_event, tabId: string) => deleteBackup(tabId))
  ipcMain.handle('session:load', async () => {
    try {
      return JSON.parse(await fs.readFile(sessionPath(), 'utf8')) as SessionState
    } catch {
      return defaultSession
    }
  })
  ipcMain.handle('session:save', (_event, state: SessionState) =>
    writeJsonAtomically(sessionPath(), state)
  )
  ipcMain.on('window:confirm-close', () => {
    allowWindowClose = true
    mainWindow?.close()
  })
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()

app.on('second-instance', (_event, argv) => {
  const pdfPath = argv.find((arg) => arg.toLowerCase().endsWith('.pdf'))
  if (pdfPath) sendToRenderer('file:open-requested', pdfPath)
  mainWindow?.show()
  mainWindow?.focus()
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (mainWindow) sendToRenderer('file:open-requested', filePath)
  else pendingFiles.push(filePath)
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('app.lepis.desktop')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerIpc()
  createMenu()
  createWindow()
  mainWindow?.webContents.once('did-finish-load', () => {
    for (const filePath of pendingFiles.splice(0)) sendToRenderer('file:open-requested', filePath)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
