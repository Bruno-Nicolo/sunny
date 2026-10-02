import type { ShortcutCommand } from '../shared/shortcuts'
import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  openPdfDialog: () => ipcRenderer.invoke('pdf:open-dialog'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readPdf: (path: string) => ipcRenderer.invoke('pdf:read', path),
  statPdf: (path: string) => ipcRenderer.invoke('pdf:stat', path),
  savePdf: (payload: {
    tabId: string
    filePath: string
    data: Uint8Array
    expectedMtimeMs: number
  }) => ipcRenderer.invoke('pdf:save', payload),
  savePdfAs: (payload: { data: Uint8Array; suggestedName: string }) =>
    ipcRenderer.invoke('pdf:save-as', payload),
  closePdf: (tabId: string) => ipcRenderer.invoke('pdf:close', tabId),
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (state: unknown) => ipcRenderer.invoke('session:save', state),
  confirmWindowClose: () => ipcRenderer.send('window:confirm-close'),
  onOpenRequested: (callback: (path: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string): void => callback(path)
    ipcRenderer.on('file:open-requested', listener)
    return () => {
      ipcRenderer.removeListener('file:open-requested', listener)
    }
  },
  onCommand: (command: ShortcutCommand | 'window-close-requested', callback: () => void) => {
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
