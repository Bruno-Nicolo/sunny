import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { Tab } from '../types'

type Props = {
  open: boolean
  closingWindow: boolean
  documents: Pick<Tab, 'id' | 'name'>[]
  onCancel(): void
  onDiscard(): void
  onSave(): void
}

export function CloseDocumentsDialog({
  open,
  closingWindow,
  documents,
  onCancel,
  onDiscard,
  onSave
}: Props): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save changes before closing?</DialogTitle>
          <DialogDescription>
            {closingWindow && documents.length > 1
              ? `${documents.length} documents have unsaved annotations.`
              : 'This document has unsaved annotations.'}
          </DialogDescription>
        </DialogHeader>
        {closingWindow && documents.length > 1 && (
          <div className="max-h-40 overflow-auto rounded-md border p-2 text-sm">
            {documents.map((tab) => (
              <div key={tab.id} className="truncate py-1">
                {tab.name}
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onDiscard}>
            Close without saving
          </Button>
          <Button onClick={onSave}>Save and close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
