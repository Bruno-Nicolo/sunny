import type { LepisApi } from '../shared/contracts'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ChatEvent, ChatgptLoginState } from '../shared/ai'

const api: LepisApi = {
  signatures: {
    list: () => ipcRenderer.invoke('signatures:list'),
    create: (dataUrl) => ipcRenderer.invoke('signatures:create', dataUrl),
    rename: (id, name) => ipcRenderer.invoke('signatures:rename', id, name),
    remove: (id) => ipcRenderer.invoke('signatures:remove', id)
  },
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    settings: (settings) => ipcRenderer.invoke('ai:settings', settings),
    connectChatgpt: () => ipcRenderer.invoke('ai:connect'),
    cancelLogin: () => ipcRenderer.invoke('ai:cancel-login'),
    setKey: (provider, key) => ipcRenderer.invoke('ai:set-key', provider, key),
    disconnect: (provider) => ipcRenderer.invoke('ai:disconnect', provider),
    models: (provider) => ipcRenderer.invoke('ai:models', provider),
    openDocument: (key, file) => ipcRenderer.invoke('ai:open-document', key, file),
    index: (document) => ipcRenderer.invoke('ai:index', document),
    conversations: (path) => ipcRenderer.invoke('ai:conversations', path),
    conversation: (id) => ipcRenderer.invoke('ai:conversation', id),
    forkConversation: (id, messageId) => ipcRenderer.invoke('ai:fork', id, messageId),
    renameConversation: (id, title) => ipcRenderer.invoke('ai:rename', id, title),
    deleteConversation: (id) => ipcRenderer.invoke('ai:delete', id),
    send: (request) => ipcRenderer.invoke('ai:send', request),
    stop: (requestId) => ipcRenderer.invoke('ai:stop', requestId),
    onLoginState: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: ChatgptLoginState): void =>
        callback(state)
      ipcRenderer.on('ai:login-state', listener)
      return () => ipcRenderer.removeListener('ai:login-state', listener)
    },
    onEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, event: ChatEvent): void =>
        callback(event)
      ipcRenderer.on('ai:event', listener)
      return () => ipcRenderer.removeListener('ai:event', listener)
    }
  },
  saveDraft: (draft) => ipcRenderer.invoke('draft:save', draft),
  loadDrafts: () => ipcRenderer.invoke('draft:load'),
  deleteDraft: (path) => ipcRenderer.invoke('draft:delete', path),
  openPdfDialog: () => ipcRenderer.invoke('pdf:open-dialog'),
  listDownloadPdfs: () => ipcRenderer.invoke('pdf:list-downloads'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readPdf: (path: string) => ipcRenderer.invoke('pdf:read', path),
  releasePdfSource: (source) => ipcRenderer.invoke('pdf:release-source', source),
  statPdf: (path: string) => ipcRenderer.invoke('pdf:stat', path),
  savePdf: (payload) => ipcRenderer.invoke('pdf:save', payload),
  savePdfAs: (payload) => ipcRenderer.invoke('pdf:save-as', payload),
  showTabContextMenu: (path) => ipcRenderer.send('pdf:tab-context-menu', path),
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
