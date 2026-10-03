import { useEffect } from 'react'
import { matchesKeyBinding, shortcuts, type ShortcutHandlers } from '../../../../shared/shortcuts'

export function useAppShortcuts(handlers: ShortcutHandlers, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      // Capture editor commands before PDF.js document listeners while a modal is open.
      const blockEditorKeys = (event: KeyboardEvent): void => {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
          )
        )
          return
        if (event.metaKey || event.ctrlKey || event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      }
      window.addEventListener('keydown', blockEditorKeys, true)
      return () => window.removeEventListener('keydown', blockEditorKeys, true)
    }

    const cleanups = shortcuts.map(({ id }) => window.lepis.onCommand(id, handlers[id]))
    const isMac = navigator.platform.startsWith('Mac')
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"], [data-slot="popover-content"]'
        )
      )
        return

      for (const shortcut of shortcuts) {
        if (
          'keys' in shortcut &&
          shortcut.keys.some((binding) => matchesKeyBinding(event, binding, isMac))
        ) {
          event.preventDefault()
          handlers[shortcut.id]()
          return
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cleanups.forEach((cleanup) => cleanup())
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled, handlers])
}
