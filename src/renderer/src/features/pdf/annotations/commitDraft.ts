import type { EditorEvents } from './editorEvents'

// Commit live text for serialization, then restore editing and the caret synchronously.
export function commitDraft(events: EditorEvents): void {
  const editor = events.getActiveEditor() ?? events.getSelectedEditor()
  if (!editor || editor.editorType !== 'freetext' || !editor.isInEditMode() || editor.isEmpty())
    return
  const input = editor.div?.querySelector<HTMLElement>('[contenteditable="true"]')
  const serialized = editor.serialize(true)
  if (
    serialized &&
    'value' in serialized &&
    input?.innerText.trimEnd().replaceAll('\u00a0', ' ') === serialized.value
  )
    return
  const selection = window.getSelection()
  const offset = (node: Node | null, position: number): number | null => {
    if (!input || !node || !input.contains(node)) return null
    const range = document.createRange()
    range.selectNodeContents(input)
    range.setEnd(node, position)
    return range.toString().length
  }
  const anchor = offset(selection?.anchorNode ?? null, selection?.anchorOffset ?? 0)
  const focus = offset(selection?.focusNode ?? null, selection?.focusOffset ?? 0)
  const focused = document.activeElement as HTMLElement | null
  editor.commit()
  editor.enableEditMode()
  focused?.focus({ preventScroll: true })
  if (!input || !selection || anchor === null || focus === null) return
  const point = (offset: number): [Node, number] => {
    const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      if (offset <= (node.textContent?.length ?? 0)) return [node, offset]
      offset -= node.textContent?.length ?? 0
      node = walker.nextNode()
    }
    return [input, input.childNodes.length]
  }
  selection.setBaseAndExtent(...point(anchor), ...point(focus))
}
