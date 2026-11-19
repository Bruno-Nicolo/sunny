import { useEffect, useRef, useState } from 'react'
import { Signature } from 'lucide-react'
import { ToolbarButton } from '@/components/ToolbarButton'
import { Button } from '@/components/ui/button'
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
  const [action, setAction] = useState<
    { type: 'rename'; id: string; name: string } | { type: 'delete'; id: string } | null
  >(null)
  const [operation, setOperation] = useState<'update' | 'save' | 'place' | null>(null)
  const busy = operation !== null
  const placing = operation === 'place'
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

  async function mutate(action: () => Promise<void>): Promise<void> {
    setOperation('update')
    setError(null)
    try {
      await action()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'The signature library could not be updated.'
      )
    } finally {
      setOperation(null)
    }
  }
  async function place(
    signature: SavedSignature | Pick<SavedSignature, 'name' | 'dataUrl'>
  ): Promise<void> {
    const viewer = getViewer()
    const session = panelSession.current
    if (!viewer || !enabled || busy || !session) return
    setOperation('save')
    setError(null)
    try {
      if (!('id' in signature)) {
        const savedSignature = await window.lepis.signatures.save(signature.name, signature.dataUrl)
        setItems((items) => [...items, savedSignature])
      }
      if (session.signal.aborted) return
      setCreating(false)
      setOperation('place')
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
      <h2 className="text-sm font-semibold">Signatures</h2>
      {loading ? (
        <p role="status">Loading signatures…</p>
      ) : (
        <>
          <div className="grid gap-3">
            {items.map((item) => (
              <div key={item.id} className="grid gap-2 rounded-md border p-3">
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
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void mutate(async () => {
                        await window.lepis.signatures.rename(item.id, action.name)
                        setItems((items) =>
                          items.map((entry) =>
                            entry.id === item.id ? { ...entry, name: action.name.trim() } : entry
                          )
                        )
                        setAction(null)
                      })
                    }}
                  >
                    <Input
                      aria-label="Rename signature"
                      maxLength={100}
                      value={action.name}
                      onChange={(event) => setAction({ ...action, name: event.target.value })}
                      autoFocus
                    />
                    <Button type="submit" disabled={busy || !action.name.trim()}>
                      Save name
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setAction(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setAction({ type: 'rename', id: item.id, name: item.name })
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setAction({ type: 'delete', id: item.id })
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                )}
                {action?.type === 'delete' && action.id === item.id && (
                  <div className="grid gap-2 text-sm">
                    <p>
                      Delete “{item.name}” from this device? Existing documents, backups and
                      recovery copies keep their signatures.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          void mutate(async () => {
                            await window.lepis.signatures.remove(item.id)
                            setItems((items) => items.filter((entry) => entry.id !== item.id))
                            setAction(null)
                          })
                        }
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                setCreating(true)
                setError(null)
              }}
            >
              Create signature
            </Button>
          </div>
        </>
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
          onSave={(name, dataUrl) => void place({ name, dataUrl })}
        />
      )}
    </>
  )
}
