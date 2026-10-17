import type { LepisApi } from '../shared/contracts'
import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api: LepisApi = {
  saveDraft: (draft) => ipcRenderer.invoke('draft:save', draft),
  loadDrafts: () => ipcRenderer.invoke('draft:load'),
  deleteDraft: (path) => ipcRenderer.invoke('draft:delete', path),
  openPdfDialog: () => ipcRenderer.invoke('pdf:open-dialog'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readPdf: (path: string) => ipcRenderer.invoke('pdf:read', path),
  releasePdfSource: (source) => ipcRenderer.invoke('pdf:release-source', source),
  statPdf: (path: string) => ipcRenderer.invoke('pdf:stat', path),
  savePdf: (payload) => ipcRenderer.invoke('pdf:save', payload),
  savePdfAs: (payload) => ipcRenderer.invoke('pdf:save-as', payload),
  closePdf: (tabId) => ipcRenderer.invoke('pdf:close', tabId),
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (state) => ipcRenderer.invoke('session:save', state),
  setTheme: (theme) => ipcRenderer.send('theme:set', theme),
  confirmWindowClose: () => ipcRenderer.send('window:confirm-close'),
  onOpenRequested: (callback: (path: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string): void => callback(path)
    ipcRenderer.on('file:open-requested', listener)
    return () => {
      ipcRenderer.removeListener('file:open-requested', listener)
    }
  },
  onCommand: (command, callback) => {
    const channel =
      command === 'window-close-requested' ? 'window:close-requested' : `menu:${command}`
    const listener = (): void => callback()
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

contextBridge.exposeInMainWorld('lepis', api)
