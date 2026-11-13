type KeyBinding = {
  key: string
  modifier?: 'command' | 'control'
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
  { id: 'print', label: 'Print…', accelerator: 'CmdOrCtrl+P' },
  { id: 'close-tab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W' },
  { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
  { id: 'redo', label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z' },
  {
    id: 'find',
    label: 'Find…',
    accelerator: 'CmdOrCtrl+F',
    keys: [{ key: 'f', modifier: 'command' }]
  },
  { id: 'toggle-chat', label: 'Toggle AI Chat', accelerator: 'CmdOrCtrl+L' },
  { id: 'new-chat', label: 'New AI Chat', accelerator: 'CmdOrCtrl+Shift+O' },
  {
    id: 'zoom-in',
    label: 'Zoom In',
    accelerator: 'CmdOrCtrl+Plus',
    keys: [
      { key: '+', modifier: 'command' },
      { key: '+', modifier: 'command', shift: true },
      { key: '=', modifier: 'command' },
      { key: '=', modifier: 'command', shift: true }
    ]
  },
  { id: 'zoom-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-' },
  { id: 'rotate-clockwise', label: 'Rotate View Clockwise', keys: [{ key: 'r' }] },
  { id: 'toggle-invert-colors', label: 'Invert Colors', keys: [{ key: 'i' }] },
  { id: 'activate-highlight', label: 'Highlight text', keys: [{ key: 'h' }] },
  { id: 'activate-text', label: 'Add text', keys: [{ key: 't' }] },
  { id: 'activate-lasso', label: 'Attach PDF region', keys: [{ key: 'l' }] },
  { id: 'deactivate-tool', label: 'Selection Tool', keys: [{ key: 'Escape' }] },
  { id: 'toggle-two-page-view', label: 'Toggle Two-Page View' },
  {
    id: 'next-tab',
    label: 'Next Tab',
    accelerator: 'Ctrl+Tab',
    keys: [{ key: 'Tab', modifier: 'control' }]
  },
  {
    id: 'previous-tab',
    label: 'Previous Tab',
    accelerator: 'Ctrl+Shift+Tab',
    keys: [{ key: 'Tab', modifier: 'control', shift: true }]
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
  { id: 'previous-page', label: 'Previous Page' },
  { id: 'next-page', label: 'Next Page' },
  { id: 'navigate-left', label: 'Navigate Left', keys: [{ key: 'ArrowLeft' }] },
  { id: 'navigate-right', label: 'Navigate Right', keys: [{ key: 'ArrowRight' }] },
  { id: 'navigate-up', label: 'Navigate Up', keys: [{ key: 'ArrowUp' }] },
  { id: 'navigate-down', label: 'Navigate Down', keys: [{ key: 'ArrowDown' }] }
] as const satisfies readonly Shortcut[]

export type ShortcutCommand = (typeof shortcuts)[number]['id']

export type ShortcutHandlers = Partial<Record<ShortcutCommand, () => void>>

export function matchesKeyBinding(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>,
  binding: KeyBinding,
  isMac: boolean
): boolean {
  const control = binding.modifier === 'control' || (binding.modifier === 'command' && !isMac)
  const command = binding.modifier === 'command' && isMac
  return (
    event.key === binding.key &&
    !event.altKey &&
    event.shiftKey === (binding.shift ?? false) &&
    event.ctrlKey === control &&
    event.metaKey === command
  )
}
