import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PdfSearchOptions, PdfSearchSnapshot } from './types'

type Props = {
  active: boolean
  request: number | null
  snapshot: PdfSearchSnapshot
  onSearch(query: string, options: PdfSearchOptions, previous?: boolean): void
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
  const [options, setOptions] = useState<PdfSearchOptions>({
    caseSensitive: false,
    entireWord: false
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const open = request !== null

  useEffect(() => {
    if (open) onSearch(query, options)
  }, [open, query, options, onSearch])

  useEffect(() => {
    if (!open || !active) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open, active, request])

  if (!open) return null
  const canNavigate = !!query && !snapshot.pending && snapshot.total > 0
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
          if (query) onSearch(query, options, event.shiftKey)
        }
      }}
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={options.caseSensitive || options.entireWord ? 'secondary' : 'ghost'}
            size="icon-xs"
            aria-label="Search options"
            title="Search options"
            className="absolute top-1.5 left-1.5 text-muted-foreground"
          >
            <Settings2 />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-52 p-1">
          {(
            [
              ['caseSensitive', 'Match case'],
              ['entireWord', 'Whole words']
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              variant="ghost"
              size="sm"
              className="w-full justify-between"
              aria-pressed={options[key]}
              onClick={() => setOptions((current) => ({ ...current, [key]: !current[key] }))}
            >
              {label}
              {options[key] && <Check className="size-3.5" />}
            </Button>
          ))}
        </PopoverContent>
      </Popover>
      <Input
        ref={inputRef}
        aria-label="Find in PDF"
        aria-describedby={hintId}
        placeholder="Find in PDF…"
        className="h-9 bg-background pr-40 pl-9 shadow-lg"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
        <span
          role="status"
          aria-live="polite"
          className="pointer-events-none mr-1 text-xs text-muted-foreground tabular-nums"
        >
          {status}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Previous result"
          title="Previous result (Shift+Enter)"
          disabled={!canNavigate}
          onClick={() => onSearch(query, options, true)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next result"
          title="Next result (Enter)"
          disabled={!canNavigate}
          onClick={() => onSearch(query, options, false)}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close search"
          title="Close search (Esc)"
          className="text-muted-foreground"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <span id={hintId} className="sr-only">
        Enter for next result, Shift+Enter for previous result, Escape to close.
      </span>
    </div>
  )
}
