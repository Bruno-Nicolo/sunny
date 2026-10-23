import { app, ipcMain } from 'electron'
import type {
  AiProvider,
  AiSettings,
  ApiProvider,
  ChatDocument,
  ChatSendRequest
} from '../../shared/ai'
import { aiProviders } from '../../shared/ai'
import { getMainWindow } from '../window'
import { AiService } from './service'

export function registerAiIpc(directory: string): void {
  const service = new AiService(directory)
  service.auth.onState((state) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send('ai:login-state', state)
  })
  const provider = (value: AiProvider): AiProvider => {
    if (!aiProviders.includes(value)) throw new Error('Unknown AI provider.')
    return value
  }
  const handle = (name: string, action: (...args: never[]) => unknown): void => {
    ipcMain.handle(`ai:${name}`, (event, ...args) => {
      if (
        event.sender !== getMainWindow()?.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error('Untrusted AI request.')
      return action(...(args as never[]))
    })
  }
  handle('status', () => service.status())
  handle('settings', (settings: Partial<AiSettings>) => service.settings(settings))
  handle('connect', async () => {
    await service.auth.connect(() => {
      const window = getMainWindow()
      if (!window || window.isDestroyed()) return
      if (window.isMinimized()) window.restore()
      window.show()
      if (process.platform === 'darwin') app.focus({ steal: true })
      window.focus()
    })
    return service.status()
  })
  handle('cancel-login', () => service.auth.cancel())
  handle('set-key', async (value: ApiProvider, key: string) => {
    if (
      provider(value) === 'chatgpt' ||
      typeof key !== 'string' ||
      key.length < 8 ||
      key.length > 1000
    )
      throw new Error('Enter a valid API key.')
    await service.credentials.update((credentials) => {
      credentials.keys[value] = key.trim()
    })
    return service.status()
  })
  handle('disconnect', async (value: AiProvider) => {
    await service.disconnect(provider(value))
    return service.status()
  })
  handle('models', (value: AiProvider) => service.providers.models(provider(value)))
  handle('index', (document: ChatDocument) => service.index(document))
  handle('conversations', (path: string) => service.store.list(path))
  handle('conversation', (id: string) => service.store.get(id))
  handle('fork', (id: string, messageId: string) => service.fork(id, messageId))
  handle('rename', (id: string, title: string) => service.store.rename(id, title))
  handle('delete', (id: string) => service.remove(id))
  handle('send', (request: ChatSendRequest) =>
    service.send(request, (event) => {
      const window = getMainWindow()
      if (window && !window.isDestroyed()) window.webContents.send('ai:event', event)
    })
  )
  handle('stop', (requestId: string) => service.stop(requestId))
  app.on('before-quit', () => service.dispose())
  app.on('browser-window-created', (_event, window) => {
    window.on('closed', () => service.dispose())
  })
}
