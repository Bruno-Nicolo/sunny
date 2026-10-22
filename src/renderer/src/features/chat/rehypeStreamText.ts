import type { Element, Root } from 'hast'

/** Keeps word spans stable as text grows, so only newly mounted words fade in. */
export function rehypeStreamText(): (tree: Root) => void {
  function visit(parent: Root | Element): void {
    parent.children = parent.children.flatMap((node) => {
      if (node.type === 'element') {
        const classes = node.properties.className
        const citation = node.tagName === 'a' && String(node.properties.href).startsWith('#source/')
        if (
          node.tagName !== 'pre' &&
          node.tagName !== 'code' &&
          !citation &&
          !(Array.isArray(classes) && classes.some((name) => String(name).startsWith('katex')))
        )
          visit(node)
      }
      if (node.type !== 'text' || !node.value.trim()) return [node]
      return (node.value.match(/\S+\s*|\s+/gu) ?? []).map((value): Element => ({
        type: 'element',
        tagName: 'span',
        properties: {
          className: [
            'chat-stream-word',
            'motion-safe:animate-[chat-stream-fade_500ms_ease-in-out]'
          ]
        },
        children: [{ type: 'text', value }]
      }))
    })
  }
  return visit
}
