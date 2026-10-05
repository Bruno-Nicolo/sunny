import { join } from 'path'
import { app, ipcMain, nativeTheme } from 'electron'
import type { SavePdfAsRequest, SavePdfRequest, SessionState } from '../shared/contracts'
import { deleteBackup, readPdf, savePdf, statPdf } from './pdf-files'
import { openPdfDialog, savePdfAs } from './pdf-dialogs'
import { loadSession, saveSession } from './session'
import { confirmWindowClose, getMainWindow } from './window'

export function registerIpc(): void {
  const userDataPath = app.getPath('userData')
  const sessionPath = join(userDataPath, 'session.json')
  ipcMain.handle('pdf:open-dialog', () => openPdfDialog(getMainWindow()))
  ipcMain.handle('pdf:read', (_event, filePath: string) => readPdf(filePath))
  ipcMain.handle('pdf:stat', (_event, filePath: string) => statPdf(filePath))
  ipcMain.handle('pdf:save', (_event, payload: SavePdfRequest) => savePdf(payload, userDataPath))
  ipcMain.handle('pdf:save-as', (_event, payload: SavePdfAsRequest) =>
    savePdfAs(getMainWindow(), payload)
  )
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
