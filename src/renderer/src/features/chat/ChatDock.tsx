import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Tab } from '@/features/documents/types'
import type { PdfDocumentHandle } from '@/features/pdf/types'
import type { ChatAttachment } from '../../../../shared/ai'
import { useAppShortcuts } from '@/features/shortcuts/useAppShortcuts'
const ChatPanel = lazy(() =>
  import('./ChatPanel').then((module) => ({ default: module.ChatPanel }))
)

type Props = {
  shortcutsEnabled: boolean
  onAskAI(attachments: ChatAttachment[]): void
  selection: { tabId: string; attachments: ChatAttachment[] } | null
  onSelectionConsumed(): void
  open: boolean
  onOpenChange(open: boolean): void
  tabs: Tab[]
  activeId: string | null
  getViewer(id: string): PdfDocumentHandle | null
  onSelectionTool(): void
  children: ReactNode
}

export function ChatDock({
  shortcutsEnabled,
  onAskAI,
  selection,
  onSelectionConsumed,
  open,
  onOpenChange,
  tabs,
  activeId,
  getViewer,
  onSelectionTool,
  children
}: Props): React.JSX.Element {
  const [width, setWidth] = useState(380)
  const [maxWidth, setMaxWidth] = useState(window.innerWidth / 2)
  const [narrow, setNarrow] = useState(window.innerWidth < 1000)
  const [activated, setActivated] = useState<string[]>([])
  const selectedViewer = useRef<PdfDocumentHandle | null>(null)
  const widthRef = useRef(width)
  const applyWidth = useCallback((width: number): void => {
    const value = Math.max(300, Math.min(window.innerWidth / 2, width))
    widthRef.current = value
    setWidth(value)
  }, [])
  useEffect(() => {
    const update = (): void => {
      setMaxWidth(window.innerWidth / 2)
      applyWidth(widthRef.current)
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [applyWidth])
  useEffect(() => {
    const media = matchMedia('(max-width: 999px)')
    const update = (): void => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  if (open && activeId && !activated.includes(activeId)) setActivated([...activated, activeId])
  const cancelSelection = useCallback((): void => {
    selectedViewer.current?.selectChatRegion(null)
    selectedViewer.current = null
  }, [])
  useEffect(() => {
    if (open || !narrow) cancelSelection()
  }, [open, narrow, cancelSelection])
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && selectedViewer.current) cancelSelection()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [cancelSelection])
  useEffect(() => cancelSelection, [activeId, cancelSelection])
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
  useAppShortcuts(
    {
      'activate-lasso': () => {
        if (tabs.find((tab) => tab.id === activeId)?.view.pages)
          selectRegion((attachment) => onAskAI([attachment]))
      }
    },
    shortcutsEnabled
  )
  return (
    <div className="relative flex min-h-0 flex-1">
      <div className={`flex min-w-0 flex-1 ${open && narrow && activeId ? 'hidden' : ''}`}>
        {children}
      </div>
      {open && activeId && !narrow && (
        <div
          role="separator"
          aria-label="Resize AI chat"
          aria-controls="ai-chat-panel"
          aria-orientation="vertical"
          aria-valuemin={300}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          tabIndex={0}
          className="relative z-25 w-3 shrink-0 touch-none cursor-col-resize outline-none"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              applyWidth(width + (event.key === 'ArrowLeft' ? 20 : -20))
            }
          }}
          onBlur={() => void persistWidth().catch(() => {})}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return
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
            className={`min-h-0 shrink-0 ${open && tab.id === activeId ? '' : 'hidden'}`}
          >
            <Suspense fallback={<p className="p-4 text-sm">Opening AI chat…</p>}>
              <ChatPanel
                key={tab.path}
                selectedAttachments={selection?.tabId === tab.id ? selection.attachments : null}
                onSelectionConsumed={onSelectionConsumed}
                tab={tab}
                active={tab.id === activeId}
                visible={open && tab.id === activeId}
                getViewer={getViewer}
                onWidth={applyWidth}
                onShowDocument={() => {
                  if (narrow) onOpenChange(false)
                }}
                onSelectRegion={selectRegion}
              />
            </Suspense>
          </aside>
        ))}
    </div>
  )
}
