import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

type Props = {
  tab: 'pages' | 'outline'
  pageCount: number
  selectedCount: number
  selecting: boolean
  busy: boolean
  canReorder: boolean
  onToggleSelection(): void
  onToggleAll(): void
  onExport(): void
  onDelete(): void
}

export function PdfNavigationHeader({
  tab,
  pageCount,
  selectedCount,
  selecting,
  busy,
  canReorder,
  onToggleSelection,
  onToggleAll,
  onExport,
  onDelete
}: Props): ReactElement {
  const allSelected = selectedCount === pageCount
  const tabClassName = 'h-full flex-none rounded-none px-0 after:bottom-0!'
  const selectButton = (
    <Button size="sm" variant="outline" disabled={busy || !canReorder} onClick={onToggleSelection}>
      Select pages
    </Button>
  )

  return (
    <div className="shrink-0">
      <div className="flex flex-col gap-4">
        <DialogTitle className="pr-6 text-base">PDF navigation</DialogTitle>
        <div className="flex min-h-9 items-center border-b">
          <TabsList
            variant="line"
            aria-label="PDF navigation views"
            className="h-9! shrink-0 justify-start gap-6 p-0"
          >
            <TabsTrigger value="pages" disabled={busy} className={tabClassName}>
              Pages
            </TabsTrigger>
            <TabsTrigger value="outline" disabled={busy} className={tabClassName}>
              Outline
            </TabsTrigger>
          </TabsList>
        </div>
      </div>
      {tab === 'pages' &&
        (selecting ? (
          <div className="mt-3 flex min-h-8 flex-wrap items-center gap-1">
            <span role="status" className="mr-auto text-sm text-muted-foreground tabular-nums">
              {selectedCount} {selectedCount === 1 ? 'page' : 'pages'} selected
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={onToggleAll}>
              {allSelected ? 'Deselect all' : 'Select all'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !selectedCount}
              onClick={onExport}
            >
              Export
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || !selectedCount || allSelected}
              onClick={onDelete}
            >
              Delete
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="ml-2"
              disabled={busy}
              onClick={onToggleSelection}
            >
              Done
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground tabular-nums">
              {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            </span>
            {selectButton}
          </div>
        ))}
    </div>
  )
}
