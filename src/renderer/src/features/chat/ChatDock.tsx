import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Tab } from '@/features/documents/types'
import type { PdfDocumentHandle } from '@/features/pdf/types'
import type { ChatAttachment } from '../../../../shared/ai'
const ChatPanel = lazy(() =>
  import('./ChatPanel').then((module) => ({ default: module.ChatPanel }))
)

type Props = {
  open: boolean
  onOpenChange(open: boolean): void
  tabs: Tab[]
  activeId: string | null
  getViewer(id: string): PdfDocumentHandle | null
  onSelectionTool(): void
  children: ReactNode
}

export function ChatDock({
  open,
  onOpenChange,
  tabs,
  activeId,
  getViewer,
  onSelectionTool,
  children
}: Props): React.JSX.Element {
  const [width, setWidth] = useState(380)
  const [narrow, setNarrow] = useState(window.innerWidth < 1000)
  const [activated, setActivated] = useState<string[]>([])
  const [previousOpen, setPreviousOpen] = useState(open)
  const [selecting, setSelecting] = useState<string | null>(null)
  const selectedViewer = useRef<PdfDocumentHandle | null>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(width)
  const applyWidth = useCallback((width: number): void => {
    const value = Math.max(300, Math.min(640, width))
    widthRef.current = value
    setWidth(value)
  }, [])
  useEffect(() => {
    const media = matchMedia('(max-width: 999px)')
    const update = (): void => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  if (open && activeId && !activated.includes(activeId)) setActivated([...activated, activeId])
  if (selecting && selecting !== activeId) setSelecting(null)
  if (previousOpen !== open) {
    setPreviousOpen(open)
    if (open || !narrow) setSelecting(null)
  }
  const cancelSelection = useCallback((): void => {
    selectedViewer.current?.selectChatRegion(null)
    selectedViewer.current = null
    setSelecting(null)
  }, [])
  useEffect(() => {
    if (open || !narrow) {
      selectedViewer.current?.selectChatRegion(null)
      selectedViewer.current = null
    }
  }, [open, narrow])
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && selectedViewer.current) cancelSelection()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [cancelSelection])
  useEffect(
    () => () => {
      selectedViewer.current?.selectChatRegion(null)
      selectedViewer.current = null
    },
    [activeId]
  )
  useEffect(
    () => () => {
      selectedViewer.current?.selectChatRegion(null)
    },
    []
  )
  const persistWidth = async (): Promise<void> => {
    await window.lepis.ai.settings({ panelWidth: widthRef.current })
  }
  const selectRegion = (callback: (attachment: ChatAttachment) => void): void => {
    if (!activeId) return
    cancelSelection()
    onSelectionTool()
    const viewer = getViewer(activeId)
    if (!viewer) return
    selectedViewer.current = viewer
    setSelecting(activeId)
    if (narrow) onOpenChange(false)
    // React first disables annotation tools, then this transient tool takes over.
    requestAnimationFrame(() => {
      if (selectedViewer.current !== viewer) return
      viewer.selectChatRegion((attachment) => {
        callback(attachment)
        cancelSelection()
        onOpenChange(true)
      })
    })
  }
  return (
    <div ref={dockRef} className="relative flex min-h-0 flex-1">
      <div className={`flex min-w-0 flex-1 ${open && narrow && activeId ? 'hidden' : ''}`}>
        {children}
      </div>
      {selecting && (
        <div className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
          Drag a rectangle on the PDF
          <Tooltip>
            <TooltipTrigger asChild>
              <button aria-label="Cancel region selection" onClick={cancelSelection}>
                <X className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Cancel region selection</TooltipContent>
          </Tooltip>
        </div>
      )}
      {open && activeId && !narrow && (
        <div
          role="separator"
          aria-label="Resize AI chat"
          aria-orientation="vertical"
          aria-valuemin={300}
          aria-valuemax={640}
          aria-valuenow={width}
          tabIndex={0}
          className="chat-resizer relative z-25 -mx-0.5 w-[5px] shrink-0 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-0.5 after:w-px after:content-[''] hover:after:bg-ring focus-visible:after:bg-ring"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              applyWidth(width + (event.key === 'ArrowLeft' ? 20 : -20))
            }
          }}
          onBlur={() => void persistWidth().catch(() => {})}
          onPointerDown={(event) => {
            event.preventDefault()
            const element = event.currentTarget
            element.setPointerCapture(event.pointerId)
            const start = event.clientX,
              initial = width
            const move = (event: PointerEvent): void => applyWidth(initial + start - event.clientX)
            const finish = (): void => {
              element.removeEventListener('pointermove', move)
              element.removeEventListener('pointerup', finish)
              element.removeEventListener('pointercancel', finish)
              void persistWidth().catch(() => {})
            }
            element.addEventListener('pointermove', move)
            element.addEventListener('pointerup', finish)
            element.addEventListener('pointercancel', finish)
          }}
        />
      )}
      {tabs
        .filter((tab) => activated.includes(tab.id))
        .map((tab) => (
          <aside
            key={tab.id}
            id={tab.id === activeId ? 'ai-chat-panel' : undefined}
            style={{ width: narrow ? '100%' : width }}
            className={`min-h-0 shrink-0 border-l ${open && tab.id === activeId ? '' : 'hidden'}`}
          >
            <Suspense fallback={<p className="p-4 text-sm">Opening AI chat…</p>}>
              <ChatPanel
                key={tab.path}
                tab={tab}
                active={tab.id === activeId}
                visible={open && tab.id === activeId}
                getViewer={getViewer}
                onWidth={applyWidth}
                onShowDocument={() => {
                  if (narrow) onOpenChange(false)
                }}
                onSelectRegion={selectRegion}
                onCancelSelection={cancelSelection}
              />
            </Suspense>
          </aside>
        ))}
    </div>
  )
}
