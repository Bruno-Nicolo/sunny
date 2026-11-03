import { Menu } from 'electron'
import { shortcuts, type ShortcutCommand } from '../shared/shortcuts'
import { sendToRenderer } from './window'

function shortcutMenuItem(id: ShortcutCommand): Electron.MenuItemConstructorOptions {
  const shortcut = shortcuts.find((entry) => entry.id === id)!
  return {
    label: shortcut.label,
    accelerator: 'accelerator' in shortcut ? shortcut.accelerator : undefined,
    click: () => sendToRenderer(`menu:${id}`)
  }
}

export function createMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Sunny',
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
        shortcutMenuItem('new-chat'),
        shortcutMenuItem('save'),
        shortcutMenuItem('print'),
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
        { role: 'selectAll' },
        { type: 'separator' },
        shortcutMenuItem('find')
      ]
    },
    {
      label: 'View',
      submenu: [
        shortcutMenuItem('toggle-chat'),
        { type: 'separator' },
        shortcutMenuItem('zoom-in'),
        shortcutMenuItem('zoom-out'),
        { type: 'separator' },
        shortcutMenuItem('rotate-clockwise'),
        shortcutMenuItem('toggle-two-page-view'),
        { type: 'separator' },
        shortcutMenuItem('previous-page'),
        shortcutMenuItem('next-page'),
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        shortcutMenuItem('deactivate-tool'),
        shortcutMenuItem('activate-highlight'),
        shortcutMenuItem('activate-text')
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
