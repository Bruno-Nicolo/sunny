import { PointerSensor, PointerActivationConstraints, KeyboardSensor } from '@dnd-kit/dom'
import { RestrictToElement } from '@dnd-kit/dom/modifiers'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Tab } from '../types'

type Props = {
  tabs: Pick<Tab, 'id' | 'path' | 'name' | 'directoryName' | 'dirty'>[]
  activeId: string | null
  onSelect(id: string): void
  onClose(id: string): void
  onReorder(id: string, index: number): void
  onOpen(): void
}

const tabModifiers = [
  RestrictToElement.configure({
    element: (operation) => operation.source?.element?.parentElement ?? null
  })
]

const sensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })]
  }),
  KeyboardSensor
]

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onReorder,
  onOpen
}: Props): React.JSX.Element {
  return (
    <DragDropProvider
      sensors={sensors}
      onDragEnd={(event) => {
        if (event.canceled) return
        const { source } = event.operation
        if (isSortable(source)) onReorder(String(source.id), source.index)
      }}
    >
      <div className="titlebar-drag relative z-10 -mb-px flex h-11 min-w-0 items-end pl-[78px]">
        <div className="titlebar-no-drag flex h-full min-w-0 flex-1 items-end gap-0.5 overflow-x-auto px-1">
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
              <Button variant="ghost" size="icon-sm" className="mb-0.5 shrink-0" onClick={onOpen}>
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open PDF (⌘O)</TooltipContent>
          </Tooltip>
        </div>
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
    <button
      ref={ref}
      type="button"
      onClick={() => onSelect(tab.id)}
      className={cn(
        'group relative flex select-none max-w-72 shrink-0 items-center gap-2 border px-3 text-left text-sm transition-colors',
        active
          ? 'h-9 rounded-t-md border-b-0 bg-background pb-px text-foreground'
          : 'mb-0.5 h-8 rounded-md border-transparent text-muted-foreground',
        !active && (isDragSource ? 'bg-muted' : 'bg-transparent hover:bg-muted/65')
      )}
      title={tab.path}
      aria-label={tab.name}
      aria-pressed={active}
    >
      {tab.dirty && <span className="size-2 shrink-0 rounded-full bg-foreground" />}
      <span className="max-w-36 truncate font-medium">{tab.name}</span>
      <span className="max-w-24 truncate text-[11px] text-muted-foreground">
        {tab.directoryName}
      </span>
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
        className="ml-auto grid size-5 place-items-center rounded opacity-0 hover:bg-muted group-hover:opacity-100"
      >
        <X className="size-3.5" />
      </span>
    </button>
  )
}
