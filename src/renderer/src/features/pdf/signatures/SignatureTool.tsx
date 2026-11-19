import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Signature, Trash2 } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { SignatureCreationDialog } from './SignatureCreationDialog'
import type { SavedSignature } from '../../../../../shared/signatures'
import type { PdfDocumentHandle } from '../types'
type Props = {
  active: boolean
  documentId: string | null
  enabled: boolean
  signed: boolean
  getViewer(): PdfDocumentHandle | undefined
  onActiveChange(active: boolean): void
  onCreationOpenChange(open: boolean): void
  children(parts: {
    control: React.JSX.Element
    panel: React.JSX.Element | null
    placing: boolean
  }): React.ReactNode
  onError(message: string): void
}

export function SignatureTool({
  active,
  documentId,
  enabled,
  signed,
  getViewer,
  onActiveChange,
  onCreationOpenChange,
  children,
  onError
}: Props): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [items, setItems] = useState<SavedSignature[]>([])
  const [action, setAction] = useState<{ type: 'rename' | 'delete'; id: string } | null>(null)
  const [operation, setOperation] = useState<'delete' | 'create' | 'place' | null>(null)
  const busy = operation !== null
  const placing = operation === 'place'
  const [pendingRenames, setPendingRenames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const panelSession = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!active || !documentId) return
    const session = new AbortController()
    panelSession.current = session
    void window.lepis.signatures
      .list()
      .then((items) => {
        if (!session.signal.aborted) setItems(items)
      })
      .catch((error: unknown) => {
        if (!session.signal.aborted)
          setError(
            error instanceof Error ? error.message : 'The signature library could not be opened.'
          )
      })
      .finally(() => {
        if (!session.signal.aborted) setLoading(false)
      })
    return () => {
      session.abort()
    }
  }, [active, documentId])
  const creationOpen = active && !loading && (creating || items.length === 0)
  useEffect(() => {
    onCreationOpenChange(creationOpen)
  }, [creationOpen, onCreationOpenChange])

  function changeActive(next: boolean): void {
    onActiveChange(next)
    if (next) {
      setLoading(true)
      setCreating(false)
      setError(null)
      setAction(null)
    }
  }
  function closeCreation(): void {
    if (busy) return
    setCreating(false)
    setError(null)
    if (!items.length) changeActive(false)
  }

  async function removeSignature(id: string): Promise<void> {
    setOperation('delete')
    setError(null)
    try {
      await window.lepis.signatures.remove(id)
      setItems((items) => items.filter((item) => item.id !== id))
      setAction(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The signature could not be deleted.')
    } finally {
      setOperation(null)
    }
  }

  async function finishRename(item: SavedSignature, draft: string): Promise<void> {
    setAction(null)
    const name = draft.trim()
    if (!name || name === item.name) return

    setError(null)
    setPendingRenames((ids) => [...ids, item.id])
    try {
      await window.lepis.signatures.rename(item.id, name)
      setItems((items) => items.map((entry) => (entry.id === item.id ? { ...entry, name } : entry)))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The signature could not be renamed.')
    } finally {
      setPendingRenames((ids) => ids.filter((id) => id !== item.id))
    }
  }

  async function place(signature: SavedSignature | string): Promise<void> {
    const viewer = getViewer()
    const session = panelSession.current
    if (!viewer || !enabled || busy || !session) return
    setOperation(typeof signature === 'string' ? 'create' : 'place')
    setError(null)
    try {
      const dataUrl = typeof signature === 'string' ? signature : signature.dataUrl
      if (typeof signature === 'string') {
        const savedSignature = await window.lepis.signatures.create(dataUrl)
        setItems((items) => [...items, savedSignature])
      }
      if (session.signal.aborted) return
      setCreating(false)
      setOperation('place')
      await viewer.placeImage(dataUrl)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The signature could not be inserted.'
      setError(message)
      onError(message)
    } finally {
      setOperation(null)
    }
  }
  const control = (
    <ToolbarButton
      label="Add signature"
      tooltip={
        signed
          ? 'Signed PDFs are read-only'
          : placing
            ? 'Cancel signature placement (Esc)'
            : 'Add signature'
      }
      disabled={!enabled}
      pressed={placing || active}
      aria-expanded={active}
      onClick={() => {
        if (placing) {
          getViewer()?.cancelImagePlacement()
          return
        }
        changeActive(!active)
      }}
    >
      <Signature />
    </ToolbarButton>
  )
  const panel = active ? (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Signatures</h2>
        <ToolbarButton
          label="Add signature"
          variant="ghost"
          disabled={loading || busy}
          onClick={() => {
            setCreating(true)
            setError(null)
          }}
        >
          <Plus />
        </ToolbarButton>
      </div>
      {loading ? (
        <p role="status">Loading signatures…</p>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <div key={item.id} className="grid gap-2 rounded-md border p-2">
              <Button
                variant="ghost"
                className="h-20 bg-white hover:bg-gray-100"
                disabled={busy}
                aria-label={`Use signature ${item.name}`}
                onClick={() => void place(item)}
              >
                <img
                  src={item.dataUrl}
                  alt={item.name}
                  className="max-h-16 max-w-full object-contain"
                />
              </Button>
              {action?.type === 'rename' && action.id === item.id ? (
                <Input
                  aria-label="Rename signature"
                  data-local-escape
                  maxLength={100}
                  defaultValue={item.name}
                  onBlur={(event) => void finishRename(item, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      setAction(null)
                    }
                  }}
                  autoFocus
                />
              ) : (
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Signature actions: ${item.name}`}
                        disabled={busy || pendingRenames.includes(item.id)}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setAction({ type: 'rename', id: item.id })}>
                        <Pencil />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setAction({ type: 'delete', id: item.id })}
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              {action?.type === 'delete' && action.id === item.id && (
                <div className="grid gap-2 text-sm">
                  <p>
                    Delete “{item.name}” from this device? Existing documents, backups and recovery
                    copies keep their signatures.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void removeSignature(item.id)}
                    >
                      Delete saved signature
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setAction(null)}
                    >
                      Keep signature
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {error && !creationOpen && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  ) : null
  return (
    <>
      {children({ control, panel, placing })}
      {creationOpen && (
        <SignatureCreationDialog
          busy={busy}
          error={error}
          onCancel={closeCreation}
          onCreate={(dataUrl) => void place(dataUrl)}
        />
      )}
    </>
  )
}
