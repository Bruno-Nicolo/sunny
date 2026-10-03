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
  onOpen(): void
}

export function TabBar({ tabs, activeId, onSelect, onClose, onOpen }: Props): React.JSX.Element {
  return (
    <div className="titlebar-drag flex h-11 min-w-0 items-end pl-[78px]">
      <div className="titlebar-no-drag flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto px-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={cn(
              'group relative flex h-9 max-w-72 shrink-0 items-center gap-2 rounded-t-md border border-b-0 px-3 text-left text-sm transition-colors',
              tab.id === activeId
                ? 'bg-background text-foreground'
                : 'border-transparent bg-muted/35 text-muted-foreground hover:bg-muted/65'
            )}
            title={tab.path}
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
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onClose(tab.id)
              }}
              className="ml-auto grid size-5 place-items-center rounded opacity-0 hover:bg-muted group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </span>
          </button>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="mb-1 shrink-0" onClick={onOpen}>
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open PDF (⌘O)</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
