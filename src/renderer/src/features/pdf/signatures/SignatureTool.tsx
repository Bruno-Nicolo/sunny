import { useEffect, useState } from 'react'
import { Check, MoreHorizontal, Pencil, Plus, Signature, Trash2, X } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
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
  onModalOpenChange(open: boolean): void
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
  onModalOpenChange,
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
  useEffect(() => {
    if (!active || !documentId) return
    const session = new AbortController()
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
  const renamingId = action?.type === 'rename' ? action.id : null
  const deleting =
    active && action?.type === 'delete' ? items.find((item) => item.id === action.id) : undefined
  const modalOpen = creationOpen || !!deleting
  useEffect(() => {
    onModalOpenChange(modalOpen)
  }, [modalOpen, onModalOpenChange])

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

  async function finishRename(item: SavedSignature, form: HTMLFormElement): Promise<void> {
    const name = String(new FormData(form).get('name') ?? '').trim()
    setAction(null)
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

  async function createSignature(dataUrl: string): Promise<void> {
    if (busy) return
    setOperation('create')
    setError(null)
    try {
      const signature = await window.lepis.signatures.create(dataUrl)
      setItems((items) => [...items, signature])
      setCreating(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The signature could not be saved.'
      setError(message)
      onError(message)
    } finally {
      setOperation(null)
    }
  }

  async function place(signature: SavedSignature): Promise<void> {
    const viewer = getViewer()
    if (!viewer || !enabled || busy) return
    setOperation('place')
    setError(null)
    try {
      await viewer.placeImage(signature.dataUrl)
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
              <div className="flex h-8 items-center gap-2">
                {renamingId === item.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1"
                    data-local-escape
                    onSubmit={(event) => {
                      event.preventDefault()
                      void finishRename(item, event.currentTarget)
                    }}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget))
                        void finishRename(item, event.currentTarget)
                    }}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
                        event.preventDefault()
                        event.currentTarget.requestSubmit()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        setAction(null)
                      }
                    }}
                  >
                    <Input
                      name="name"
                      aria-label="Rename signature"
                      className="h-auto min-w-0 flex-1 rounded-none border-0 p-0 text-sm shadow-[inset_0_-1px_0_var(--ring)] focus-visible:ring-0"
                      maxLength={100}
                      defaultValue={item.name}
                      onFocus={(event) => event.currentTarget.select()}
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Cancel rename"
                      onClick={() => setAction(null)}
                    >
                      <X />
                    </Button>
                    <Button type="submit" size="icon-xs" aria-label="Save name">
                      <Check />
                    </Button>
                  </form>
                ) : (
                  <>
                    <span data-signature-name className="min-w-0 flex-1 truncate text-sm">
                      {item.name}
                    </span>
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
                        <DropdownMenuItem
                          onSelect={() => setAction({ type: 'rename', id: item.id })}
                        >
                          <Pencil />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            setError(null)
                            setAction({ type: 'delete', id: item.id })
                          }}
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && !modalOpen && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  ) : null
  return (
    <>
      {children({ control, panel, placing })}
      {deleting && (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setAction(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete signature?</AlertDialogTitle>
              <AlertDialogDescription className="break-words">
                Delete “{deleting.name}” from this device? Existing documents, backups and recovery
                copies keep their signatures.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Keep</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault()
                  void removeSignature(deleting.id)
                }}
              >
                {busy ? 'Deleting…' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {creationOpen && (
        <SignatureCreationDialog
          busy={busy}
          error={error}
          onCancel={closeCreation}
          onCreate={(dataUrl) => void createSignature(dataUrl)}
        />
      )}
    </>
  )
}
