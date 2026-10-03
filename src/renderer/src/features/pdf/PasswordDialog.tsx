import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

type Props = { open: boolean; incorrect: boolean; onSubmit(password: string): void }

export function PasswordDialog({ open, incorrect, onSubmit }: Props): React.JSX.Element {
  const [password, setPassword] = useState('')
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Password required</DialogTitle>
          <DialogDescription>
            {incorrect
              ? 'The password was incorrect. Try again.'
              : 'This PDF is protected. Enter its password to open it.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!password) return
            onSubmit(password)
            setPassword('')
          }}
        >
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            aria-label="PDF password"
          />
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={!password}>
              Open
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
