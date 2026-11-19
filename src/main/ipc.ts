import { join } from 'path'
import { createSignatureStore } from './signatures'
import { app, clipboard, ipcMain, Menu, nativeTheme, type WebContents } from 'electron'
import type {
  PdfCopyDestination,
  PdfSource,
  SavePdfAsRequest,
  SavePdfRequest,
  SavePdfDraftRequest,
  SessionState
} from '../shared/contracts'
import { releasePdfSource } from './pdf-sources'
import { deleteBackup, readPdf, savePdf, statPdf, writePdfCopy } from './pdf-files'
import { choosePdfCopyPath, openPdfDialog } from './pdf-dialogs'
import { createDraftStore } from './drafts'
import { loadSession, saveSession } from './session'
import { confirmWindowClose, getMainWindow } from './window'
import { registerAiIpc } from './ai/ipc'
import { listDownloadPdfs } from './suggested-pdfs'

export function registerIpc(): void {
  const userDataPath = app.getPath('userData')
  registerAiIpc(userDataPath)
  const signatures = createSignatureStore(userDataPath)
  ipcMain.handle('signatures:list', () => signatures.list())
  ipcMain.handle('signatures:create', (_event, dataUrl: string) => signatures.create(dataUrl))
  ipcMain.handle('signatures:rename', (_event, id: string, name: string) =>
    signatures.rename(id, name)
  )
  ipcMain.handle('signatures:remove', (_event, id: string) => signatures.remove(id))
  const sessionPath = join(userDataPath, 'session.json')
  const drafts = createDraftStore(userDataPath)
  ipcMain.handle('draft:save', (_event, draft: SavePdfDraftRequest) => drafts.save(draft))
  ipcMain.handle('draft:load', () => drafts.load())
  ipcMain.handle('draft:delete', (_event, path: string) => drafts.remove(path))
  ipcMain.handle('pdf:open-dialog', () => openPdfDialog(getMainWindow()))
  ipcMain.handle('pdf:list-downloads', () => listDownloadPdfs(app.getPath('downloads')))
  ipcMain.handle('pdf:read', (_event, filePath: string) => readPdf(filePath))
  ipcMain.handle('pdf:release-source', (_event, source: PdfSource) => releasePdfSource(source))
  ipcMain.handle('pdf:stat', (_event, filePath: string) => statPdf(filePath))
  ipcMain.handle('pdf:save', (_event, payload: SavePdfRequest) => savePdf(payload, userDataPath))
  ipcMain.handle('pdf:save-as', async (_event, payload: SavePdfAsRequest) => {
    const path = await choosePdfCopyPath(getMainWindow(), payload)
    if (path) await writePdfCopy(path, payload.data)
    return path
  })
  const flattenedPaths = new WeakMap<WebContents, string>()
  ipcMain.handle('pdf:choose-flattened-copy', async (event, destination: PdfCopyDestination) => {
    const window = getMainWindow()
    if (!window || event.sender !== window.webContents) return false
    const path = await choosePdfCopyPath(window, destination)
    if (!path) return false
    flattenedPaths.set(event.sender, path)
    return true
  })
  ipcMain.handle('pdf:finish-flattened-copy', async ({ sender }, rendered: boolean) => {
    const path = flattenedPaths.get(sender)
    flattenedPaths.delete(sender)
    if (!rendered) return
    if (!path) throw new Error('Choose a destination for the flattened PDF first.')
    const data = await sender.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      generateTaggedPDF: false
    })
    await writePdfCopy(path, data)
  })
  ipcMain.on('pdf:tab-context-menu', (event, filePath: string) => {
    const window = getMainWindow()
    if (!window || event.sender !== window.webContents) return
    Menu.buildFromTemplate([
      { label: 'Copy full path', click: () => clipboard.writeText(filePath) }
    ]).popup({ window })
  })
  ipcMain.handle('pdf:close', (_event, tabId: string) => deleteBackup(userDataPath, tabId))
  ipcMain.handle('session:load', () => loadSession(sessionPath))
  let sessionWrite: Promise<void> = Promise.resolve()
  ipcMain.handle('session:save', (_event, state: SessionState) => {
    sessionWrite = sessionWrite.catch(() => {}).then(() => saveSession(sessionPath, state))
    return sessionWrite
  })
  ipcMain.on('window:confirm-close', confirmWindowClose)
  ipcMain.on('theme:set', (_event, theme: SessionState['theme']) => {
    nativeTheme.themeSource = theme
  })
}
