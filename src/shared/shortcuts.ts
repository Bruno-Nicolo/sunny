type KeyBinding = {
  key: string
  modifier?: 'command'
  shift?: boolean
}

type Shortcut = {
  id: string
  label: string
  accelerator?: string
  keys?: readonly KeyBinding[]
}

// Configure application shortcuts here; native menus and the renderer share this registry.
export const shortcuts = [
  { id: 'open', label: 'Open…', accelerator: 'CmdOrCtrl+O' },
  { id: 'save', label: 'Save', accelerator: 'CmdOrCtrl+S' },
  { id: 'close-tab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W' },
  { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
  { id: 'redo', label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z' },
  {
    id: 'zoom-in',
    label: 'Zoom In',
    accelerator: 'CmdOrCtrl+Plus',
    keys: [{ key: '=', modifier: 'command' }]
  },
  { id: 'zoom-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-' },
  {
    id: 'next-tab',
    label: 'Next Tab',
    accelerator: 'Ctrl+Tab',
    keys: [{ key: 'Tab', modifier: 'command' }]
  },
  {
    id: 'previous-tab',
    label: 'Previous Tab',
    accelerator: 'Ctrl+Shift+Tab',
    keys: [{ key: 'Tab', modifier: 'command', shift: true }]
  },
  { id: 'tab-1', label: 'Tab 1', accelerator: 'CmdOrCtrl+1' },
  { id: 'tab-2', label: 'Tab 2', accelerator: 'CmdOrCtrl+2' },
  { id: 'tab-3', label: 'Tab 3', accelerator: 'CmdOrCtrl+3' },
  { id: 'tab-4', label: 'Tab 4', accelerator: 'CmdOrCtrl+4' },
  { id: 'tab-5', label: 'Tab 5', accelerator: 'CmdOrCtrl+5' },
  { id: 'tab-6', label: 'Tab 6', accelerator: 'CmdOrCtrl+6' },
  { id: 'tab-7', label: 'Tab 7', accelerator: 'CmdOrCtrl+7' },
  { id: 'tab-8', label: 'Tab 8', accelerator: 'CmdOrCtrl+8' },
  { id: 'tab-9', label: 'Tab 9', accelerator: 'CmdOrCtrl+9' },
  { id: 'previous-page', label: 'Previous Page', keys: [{ key: 'ArrowLeft' }] },
  { id: 'next-page', label: 'Next Page', keys: [{ key: 'ArrowRight' }] }
] as const satisfies readonly Shortcut[]

export type ShortcutCommand = (typeof shortcuts)[number]['id']

export type ShortcutHandlers = Record<ShortcutCommand, () => void>

export function matchesKeyBinding(event: KeyboardEvent, binding: KeyBinding): boolean {
  const command = navigator.platform.startsWith('Mac') ? event.metaKey : event.ctrlKey
  return (
    event.key === binding.key &&
    !event.altKey &&
    event.shiftKey === (binding.shift ?? false) &&
    (binding.modifier === 'command'
      ? command && !(navigator.platform.startsWith('Mac') ? event.ctrlKey : event.metaKey)
      : !event.ctrlKey && !event.metaKey)
  )
}
