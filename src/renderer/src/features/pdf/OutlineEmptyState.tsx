import { ListTree } from 'lucide-react'

export function OutlineEmptyState(): React.JSX.Element {
  return (
    <div className="grid h-full min-h-80 place-items-center px-4 py-10">
      <div role="status" className="w-full max-w-xs text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl bg-muted/70 text-muted-foreground"
        >
          <ListTree className="size-5" strokeWidth={1.5} />
        </div>
        <h3 className="text-base font-medium">No outline available</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">This PDF has no table of contents.</p>
      </div>
    </div>
  )
}
