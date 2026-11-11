import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { ChevronRight } from 'lucide-react'
import { Collapsible } from 'radix-ui'
export type Outline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>

function OutlinePageNumber({
  document,
  destination
}: { document: PDFDocumentProxy } & { destination: string | unknown[] }): React.JSX.Element | null {
  const [page, setPage] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const resolvePage = async (): Promise<number | null> => {
      const target =
        typeof destination === 'string' ? await document.getDestination(destination) : destination
      if (!target) return null
      const reference = target[0]
      const index =
        typeof reference === 'number'
          ? reference
          : await document.getPageIndex(reference as { num: number; gen: number })
      return Number.isInteger(index) && index >= 0 && index < document.numPages ? index + 1 : null
    }
    void resolvePage()
      .then((number) => {
        if (!cancelled) setPage(number)
      })
      .catch(() => {
        if (!cancelled) setPage(null)
      })
    return () => {
      cancelled = true
    }
  }, [document, destination])

  return page === null ? null : (
    <span
      aria-label={`Page ${page}`}
      className="ml-auto shrink-0 pl-4 text-muted-foreground tabular-nums"
    >
      p. {page}
    </span>
  )
}

export function OutlineItems({
  document,
  items,
  prefix = '',
  onDestination,
  onError
}: {
  document: PDFDocumentProxy
  onDestination(destination: string | unknown[]): Promise<void>
  onError(message: string): void
} & {
  items: Outline
  prefix?: string
}): React.JSX.Element {
  return (
    <ul className="space-y-1">
      {items.map((item, index) => {
        const destination = item.dest
        const number = `${prefix}${index + 1}`
        return (
          <Collapsible.Root key={index} asChild>
            <li>
              <div className="flex items-start gap-1">
                {item.items.length > 0 ? (
                  <Collapsible.Trigger asChild>
                    <button
                      type="button"
                      aria-label={`Toggle section: ${item.title}`}
                      className="group mt-1 grid size-6 shrink-0 place-items-center rounded-md hover:bg-accent focus-visible:outline-ring"
                    >
                      <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                    </button>
                  </Collapsible.Trigger>
                ) : (
                  <span className="w-6 shrink-0" />
                )}
                {destination ? (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-1 py-1.5 text-left text-sm break-words hover:bg-accent focus-visible:outline-ring"
                    onClick={() =>
                      void onDestination(destination).catch(() =>
                        onError('The outline destination could not be opened.')
                      )
                    }
                  >
                    <span className="shrink-0 text-muted-foreground tabular-nums">{number}</span>
                    <span
                      data-slot="outline-title"
                      className="min-w-0 flex-1"
                      style={{
                        fontWeight: item.bold ? 600 : undefined,
                        fontStyle: item.italic ? 'italic' : undefined
                      }}
                    >
                      {item.title}
                    </span>
                    <OutlinePageNumber document={document} destination={destination} />
                  </button>
                ) : (
                  <span className="flex min-w-0 flex-1 items-start gap-2 px-1 py-1.5 text-sm break-words text-muted-foreground">
                    <span className="shrink-0 tabular-nums">{number}</span>
                    <span className="min-w-0">{item.title}</span>
                  </span>
                )}
              </div>
              {item.items.length > 0 && (
                <Collapsible.Content className="ml-3 border-l pl-2">
                  <OutlineItems
                    document={document}
                    items={item.items}
                    prefix={`${number}.`}
                    onDestination={onDestination}
                    onError={onError}
                  />
                </Collapsible.Content>
              )}
            </li>
          </Collapsible.Root>
        )
      })}
    </ul>
  )
}
