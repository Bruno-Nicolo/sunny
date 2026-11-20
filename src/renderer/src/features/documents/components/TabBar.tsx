import { useEffect, useRef, useState } from 'react'
import { RestrictToElement } from '@dnd-kit/dom/modifiers'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { Monitor, Moon, PanelRight, Plus, Sun, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { dragSensors } from '@/lib/dragSensors'
import type { SessionState } from '../../../../../shared/contracts'
import type { Tab } from '../types'
import { DirectoryPath } from './DirectoryPath'

type Props = {
  tabs: Pick<Tab, 'id' | 'path' | 'name' | 'directoryPath' | 'dirty'>[]
  activeId: string | null
  chatOpen: boolean
  onToggleChat(): void
  theme: SessionState['theme']
  onSelect(id: string): void
  onClose(id: string): void
  onReorder(id: string, index: number): void
  onOpen(): void
  onCycleTheme(): void
}

const tabModifiers = [
  RestrictToElement.configure({
    element: (operation) => operation.source?.element?.parentElement ?? null
  })
]

export function TabBar({
  tabs,
  activeId,
  chatOpen,
  onToggleChat,
  theme,
  onSelect,
  onClose,
  onReorder,
  onOpen,
  onCycleTheme
}: Props): React.JSX.Element {
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  const tabStripRef = useRef<HTMLDivElement>(null)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const [hasMoreTabs, setHasMoreTabs] = useState(false)
  const [hasPreviousTabs, setHasPreviousTabs] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setHasMoreTabs(entry.intersectionRatio < 1),
      { root: tabStripRef.current, threshold: 1 }
    )
    observer.observe(openButtonRef.current!)
    return () => observer.disconnect()
  }, [])

  return (
    <DragDropProvider
      sensors={dragSensors}
      onDragEnd={(event) => {
        if (event.canceled) return
        const { source } = event.operation
        if (isSortable(source)) onReorder(String(source.id), source.index)
      }}
    >
      <div className="titlebar-drag relative z-10 flex h-12 min-w-0 items-center pr-3 pl-[92px]">
        <div className="relative flex h-full min-w-0 flex-1">
          <div
            ref={tabStripRef}
            onScroll={(event) => setHasPreviousTabs(event.currentTarget.scrollLeft > 0)}
            className="titlebar-no-drag flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-2 [scrollbar-width:none]"
          >
            {tabs.map((tab, index) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                index={index}
                active={tab.id === activeId}
                onSelect={onSelect}
                onClose={onClose}
              />
            ))}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  ref={openButtonRef}
                  variant="ghost"
                  size="icon"
                  className="mr-1 -ml-1"
                  aria-label="Open PDF"
                  onClick={onOpen}
                >
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open PDF (⌘O)</TooltipContent>
            </Tooltip>
          </div>
          {hasPreviousTabs && (
            <div
              aria-hidden="true"
              data-slot="tab-overflow-hint"
              className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-background/70 backdrop-blur-[2px] [mask-image:linear-gradient(to_left,transparent,black)]"
            />
          )}
          {hasMoreTabs && (
            <div
              aria-hidden="true"
              data-slot="tab-overflow-hint"
              className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-background/70 backdrop-blur-[2px] [mask-image:linear-gradient(to_right,transparent,black)]"
            />
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="titlebar-no-drag"
              aria-label={`Change theme: ${theme}`}
              onClick={onCycleTheme}
            >
              <ThemeIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Theme: {theme}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="titlebar-no-drag"
              disabled={!activeId}
              aria-label="Toggle AI chat"
              aria-expanded={chatOpen && Boolean(activeId)}
              aria-controls="ai-chat-panel"
              onClick={onToggleChat}
            >
              <PanelRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{chatOpen ? 'Hide AI chat' : 'Show AI chat'} (⌘L)</TooltipContent>
        </Tooltip>
      </div>
    </DragDropProvider>
  )
}

type SortableTabProps = Pick<Props, 'onSelect' | 'onClose'> & {
  tab: Props['tabs'][number]
  index: number
  active: boolean
}

function SortableTab({
  tab,
  index,
  active,
  onSelect,
  onClose
}: SortableTabProps): React.JSX.Element {
  const { ref, isDragSource } = useSortable({ id: tab.id, index, modifiers: tabModifiers })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          onClick={() => onSelect(tab.id)}
          onContextMenu={(event) => {
            event.preventDefault()
            window.lepis.showTabContextMenu(tab.path)
          }}
          className={cn(
            'document-tab group relative flex h-8 min-w-[120px] max-w-60 flex-1 basis-60 select-none items-center gap-2 rounded-md border border-transparent px-3 py-1 text-left text-sm outline-offset-[-4px]',
            '[&:has(+button:is([data-active=true],:hover,[data-dragging=true]))>[data-slot=tab-separator]]:opacity-0',
            '[&:not(:has(+.document-tab))>[data-slot=tab-separator]]:hidden',
            active
              ? 'border-foreground/6 bg-foreground/6 text-foreground dark:border-border dark:bg-sidebar'
              : 'text-muted-foreground hover:bg-foreground/7 data-[dragging=true]:bg-foreground/7'
          )}
          aria-label={tab.name}
          aria-pressed={active}
          data-active={active}
          data-dragging={isDragSource}
        >
          <span
            data-slot="tab-separator"
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute top-1/2 -right-1 h-4 w-px -translate-y-1/2 bg-muted group-hover:opacity-0 group-data-[dragging=true]:opacity-0',
              active && 'opacity-0'
            )}
          />
          {tab.dirty && <span className="size-2 shrink-0 rounded-full bg-foreground" />}
          <span className="min-w-0 flex-1 truncate font-medium leading-5">{tab.name}</span>
          <span
            role="button"
            tabIndex={0}
            aria-label={`Close ${tab.name}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onClose(tab.id)
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onClose(tab.id)
              }
            }}
            className="ml-auto grid size-5 shrink-0 place-items-center rounded-full hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-3.5" />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="max-w-[min(28rem,calc(100vw-2rem))] space-y-1 text-left text-wrap"
        hidden={isDragSource}
      >
        <div className="font-medium break-all">{tab.name}</div>
        <DirectoryPath path={tab.directoryPath} />
      </TooltipContent>
    </Tooltip>
  )
}
