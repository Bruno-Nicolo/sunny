import { lazy, Suspense, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

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
  onCreate(dataUrl: string): void
}

export function SignatureCreationDialog({
  busy,
  error,
  onCancel,
  onCreate
}: Props): React.JSX.Element {
  const [mode, setMode] = useState<'draw' | 'image'>('draw')
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)

  function changeMode(next: typeof mode): void {
    if (next === mode) return
    setMode(next)
    setDataUrl(null)
    setPreparing(false)
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
        <Tabs value={mode} onValueChange={changeMode} className="min-w-0 gap-4">
          <TabsList aria-label="Signature source" className="w-full">
            <TabsTrigger value="draw" disabled={busy}>
              Draw
            </TabsTrigger>
            <TabsTrigger value="image" disabled={busy}>
              Import image
            </TabsTrigger>
          </TabsList>
          <Suspense fallback={<p role="status">Preparing signature editor…</p>}>
            <TabsContent value="draw">
              <SignatureDraw onChange={setDataUrl} />
            </TabsContent>
            <TabsContent value="image">
              <SignatureImport onChange={setDataUrl} onPreparingChange={setPreparing} />
            </TabsContent>
          </Suspense>
        </Tabs>
        <div
          className="group grid min-h-20 place-items-center rounded-md border bg-white p-3"
          role="group"
          aria-label="Signature preview"
          aria-busy={preparing}
        >
          {dataUrl ? (
            <img
              src={dataUrl}
              alt="Signature preview"
              className="max-h-24 max-w-full object-contain group-aria-busy:opacity-75 motion-safe:transition-opacity"
            />
          ) : (
            <span className="text-sm text-gray-500">Signature preview</span>
          )}
        </div>
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
            disabled={busy || preparing || !dataUrl}
            onClick={() => {
              if (dataUrl) onCreate(dataUrl)
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
