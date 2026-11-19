import { lazy, Suspense, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
const SignatureDraw = lazy(() =>
  import('./SignatureDraw').then((module) => ({ default: module.SignatureDraw }))
)
const SignatureImport = lazy(() =>
  import('./SignatureImport').then((module) => ({ default: module.SignatureImport }))
)

type Props = {
  busy: boolean
  error: string | null
  onCancel(): void
  onSave(name: string, dataUrl: string): void
}

export function SignatureCreationDialog({
  busy,
  error,
  onCancel,
  onSave
}: Props): React.JSX.Element {
  const [mode, setMode] = useState<'draw' | 'image'>('draw')
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [name, setName] = useState('')

  function changeMode(next: typeof mode): void {
    if (next === mode) return
    setMode(next)
    setDataUrl(null)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create signature</DialogTitle>
          <DialogDescription>The signature is saved on this device for reuse.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Signature source">
          <Button
            variant={mode === 'draw' ? 'secondary' : 'ghost'}
            aria-pressed={mode === 'draw'}
            disabled={busy}
            onClick={() => changeMode('draw')}
          >
            Draw
          </Button>
          <Button
            variant={mode === 'image' ? 'secondary' : 'ghost'}
            aria-pressed={mode === 'image'}
            disabled={busy}
            onClick={() => changeMode('image')}
          >
            Import image
          </Button>
        </div>
        <Suspense fallback={<p role="status">Preparing signature editor…</p>}>
          {mode === 'draw' ? (
            <SignatureDraw onChange={setDataUrl} />
          ) : (
            <SignatureImport onChange={setDataUrl} />
          )}
        </Suspense>
        <div
          className="grid min-h-20 place-items-center rounded-md border bg-white p-3"
          aria-label="Signature preview"
        >
          {dataUrl ? (
            <img
              src={dataUrl}
              alt="Signature preview"
              className="max-h-24 max-w-full object-contain"
            />
          ) : (
            <span className="text-sm text-gray-500">Signature preview</span>
          )}
        </div>
        <label className="grid gap-2 text-sm">
          Signature name
          <Input
            aria-label="Signature name"
            maxLength={100}
            disabled={busy}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={busy || !dataUrl || !name.trim()}
            onClick={() => {
              if (dataUrl) onSave(name, dataUrl)
            }}
          >
            Save and use signature
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
