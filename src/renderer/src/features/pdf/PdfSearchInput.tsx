import { useEffect, useId, useRef, useState } from 'react'
import { X, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PdfSearchSnapshot } from './types'

type Props = {
  active: boolean
  request: number | null
  snapshot: PdfSearchSnapshot
  onSearch(query: string, previous?: boolean): void
  onClose(): void
}

export function PdfSearchInput({
  active,
  request,
  snapshot,
  onSearch,
  onClose
}: Props): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const open = request !== null

  useEffect(() => {
    if (open) onSearch(query)
  }, [open, query, onSearch])

  useEffect(() => {
    if (!open || !active) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open, active, request])

  if (!open) return null
  const status = !query
    ? ''
    : snapshot.pending
      ? 'Searching…'
      : snapshot.total
        ? `${snapshot.current} of ${snapshot.total}`
        : 'No results'

  return (
    <div
      role="search"
      aria-label="Find in PDF"
      className="absolute top-3 right-3 z-20 w-72 max-w-[calc(100%-1.5rem)]"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        } else if (event.key === 'Enter' && event.target === inputRef.current) {
          event.preventDefault()
          if (query) onSearch(query, event.shiftKey)
        }
      }}
    >
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        aria-label="Find in PDF"
        aria-describedby={hintId}
        placeholder="Find in PDF…"
        className="h-9 bg-background pr-32 pl-9 shadow-lg"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <span
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute inset-y-0 right-9 flex items-center text-xs text-muted-foreground tabular-nums"
      >
        {status}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Close search"
        title="Close search (Esc)"
        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
        onClick={onClose}
      >
        <X />
      </Button>
      <span id={hintId} className="sr-only">
        Enter for next result, Shift+Enter for previous result, Escape to close.
      </span>
    </div>
  )
}
