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
  open: boolean
  onCancel(): void
  onSaveCopy(): void
  onReload(): void
}

export function FileConflictDialog({
  open,
  onCancel,
  onSaveCopy,
  onReload
}: Props): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>The original file is unavailable or changed</DialogTitle>
          <DialogDescription>
            The original PDF could not be overwritten safely. Reloading discards your unsaved
            changes. You can also preserve the Lepis version as a separate PDF.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onSaveCopy}>
            Save as copy
          </Button>
          <Button variant="destructive" onClick={onReload}>
            Reload and discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
