import { useState } from 'react'
import type { PdfDraft } from '../../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

type Props = {
  drafts: PdfDraft[]
  onRecover(): Promise<void>
  onDiscard(): Promise<void>
}

export function RecoveryDialog({ drafts, onRecover, onDiscard }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={drafts.length > 0}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Recover unsaved changes?</DialogTitle>
          <DialogDescription>
            Local recovery copies were found. Recover your annotations or discard these copies. Your
            original PDFs have not been changed by recovery.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-60 overflow-auto rounded-md border p-3 text-sm">
          {drafts.map((draft) => (
            <li key={draft.path} className="py-1">
              <div className="truncate" title={draft.path}>
                {draft.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(draft.savedAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => void run(onDiscard)}>
            Discard recovery copies
          </Button>
          <Button disabled={busy} onClick={() => void run(onRecover)}>
            Recover changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
