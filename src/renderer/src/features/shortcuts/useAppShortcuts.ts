import { useEffect, useEffectEvent } from 'react'
import {
  matchesKeyBinding,
  shortcuts,
  type ShortcutCommand,
  type ShortcutHandlers
} from '../../../../shared/shortcuts'

export function useAppShortcuts(handlers: ShortcutHandlers, enabled: boolean): void {
  const dispatch = useEffectEvent((id: ShortcutCommand): boolean => {
    const handler = handlers[id]
    if (!handler) return false
    handler()
    return true
  })
  useEffect(() => {
    if (!enabled) {
      // Capture editor commands before PDF.js document listeners while a modal is open.
      const blockEditorKeys = (event: KeyboardEvent): void => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === 'a' &&
          event.target instanceof HTMLElement &&
          event.target.closest('[data-page-selection="true"]')
        )
          return
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

    const cleanups = shortcuts.map(({ id }) => window.lepis.onCommand(id, () => dispatch(id)))
    const isMac = navigator.platform.startsWith('Mac')
    const selectionShortcut = shortcuts.find((shortcut) => shortcut.id === 'deactivate-tool')!
    // Deactivate tools even when editors or popovers consume Escape; let them handle it too.
    const onToolEscape = (event: KeyboardEvent): void => {
      if (
        !event.isComposing &&
        !(event.target instanceof HTMLElement && event.target.closest('[data-local-escape]')) &&
        selectionShortcut.keys.some((binding) => matchesKeyBinding(event, binding, isMac))
      )
        dispatch(selectionShortcut.id)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('[role="dialog"], [role="menu"], [data-slot="popover-content"]')
      )
        return

      const editing =
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
      for (const shortcut of shortcuts) {
        if (
          shortcut.id !== selectionShortcut.id &&
          (!editing || shortcut.id === 'find') &&
          'keys' in shortcut &&
          shortcut.keys.some((binding) => matchesKeyBinding(event, binding, isMac))
        ) {
          if (dispatch(shortcut.id)) event.preventDefault()
          return
        }
      }
    }
    window.addEventListener('keydown', onToolEscape, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cleanups.forEach((cleanup) => cleanup())
      window.removeEventListener('keydown', onToolEscape, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled])
}
