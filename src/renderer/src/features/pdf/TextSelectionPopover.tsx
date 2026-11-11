import { useEffect, useState, type RefObject } from 'react'
import { Highlighter, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import type { ChatAttachment } from '../../../../shared/ai'
import type { PdfDocumentHandle } from './types'

type Props = {
  containerRef: RefObject<HTMLDivElement | null>
  canAnnotate: boolean
  handle: Pick<PdfDocumentHandle, 'highlightSelectedText' | 'attachSelectedText'>
  onAskAI(attachments: ChatAttachment[]): void
}

export function TextSelectionPopover({
  containerRef,
  canAnnotate,
  handle,
  onAskAI
}: Props): React.JSX.Element | null {
  const [bounds, setBounds] = useState<DOMRect | null>(null)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let selecting = false
    let frame = 0
    const dismiss = (): void => setBounds(null)
    const update = (): void => {
      const selection = window.getSelection()
      if (
        !selection?.rangeCount ||
        selection.isCollapsed ||
        !selection.toString().trim() ||
        !selection.anchorNode?.parentElement?.closest('.textLayer') ||
        !selection.focusNode?.parentElement?.closest('.textLayer') ||
        !container.contains(selection.anchorNode) ||
        !container.contains(selection.focusNode) ||
        container.classList.contains('chat-region-mode') ||
        document.fullscreenElement
      ) {
        dismiss()
        return
      }
      const rects = [...selection.getRangeAt(0).getClientRects()]
      const viewport = container.getBoundingClientRect()
      const rect = rects.find(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > viewport.top &&
          rect.top < viewport.bottom
      )
      setBounds(rect ?? null)
    }
    const pointerDown = (event: PointerEvent): void => {
      dismiss()
      selecting = event.button === 0 && Boolean((event.target as Element).closest('.textLayer'))
    }
    const pointerUp = (): void => {
      if (!selecting) return
      selecting = false
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const selectionChanged = (): void => {
      if (window.getSelection()?.isCollapsed) dismiss()
    }
    const abort = new AbortController()
    const options = { signal: abort.signal }
    container.addEventListener('pointerdown', pointerDown, options)
    document.addEventListener('pointerup', pointerUp, options)
    document.addEventListener(
      'pointercancel',
      () => {
        selecting = false
        dismiss()
      },
      options
    )
    document.addEventListener('selectionchange', selectionChanged, options)
    document.addEventListener('fullscreenchange', dismiss, options)
    container.addEventListener('scroll', dismiss, options)
    window.addEventListener('resize', dismiss, options)
    return () => {
      abort.abort()
      cancelAnimationFrame(frame)
    }
  }, [containerRef])

  if (!bounds) return null
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) setBounds(null)
      }}
    >
      <PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => bounds } }} />
      <PopoverContent
        aria-label="Text selection actions"
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="flex w-auto items-center gap-0.5 rounded-lg p-1 shadow-lg"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={!canAnnotate}
          className="h-7 text-xs"
          onClick={() => {
            handle.highlightSelectedText()
            setBounds(null)
          }}
        >
          <Highlighter className="size-3.5" />
          Highlight
        </Button>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="h-7 text-xs"
          onClick={() => {
            const attachments = handle.attachSelectedText()
            setBounds(null)
            if (attachments.length) onAskAI(attachments)
          }}
        >
          <Sparkles className="size-3.5" />
          Ask AI
        </Button>
      </PopoverContent>
    </Popover>
  )
}
