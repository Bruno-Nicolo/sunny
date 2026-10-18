import { useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from '@/components/ui/dropdown-menu'
import type { ConversationSummary } from '../../../../shared/ai'
import { ProviderLogo } from './ProviderLogo'

type Props = {
  chats: ConversationSummary[]
  label: string
  disabled: boolean
  onOpen(id: string): Promise<void>
  onRename(id: string, title: string): Promise<void>
  onDelete(id: string): Promise<void>
  onError(error: unknown): void
}

export function ConversationHistory({
  chats,
  label,
  disabled,
  onOpen,
  onRename,
  onDelete,
  onError
}: Props): React.JSX.Element {
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null)
  const [pending, setPending] = useState(false)
  const run = async (action: () => Promise<void>, done: () => void): Promise<void> => {
    setPending(true)
    try {
      await action()
      done()
    } catch (error) {
      onError(error)
    } finally {
      setPending(false)
    }
  }
  return (
    <nav aria-label={label} className="w-full space-y-2">
      <p className="px-2 text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="space-y-1">
        {chats.map((chat) => (
          <li key={chat.id} className="flex min-w-0 items-center gap-1">
            {editing?.id === chat.id ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  const title = editing.title.trim()
                  if (title && !pending)
                    void run(
                      () => onRename(chat.id, title),
                      () => setEditing(null)
                    )
                }}
              >
                <Input
                  autoFocus
                  aria-label="Chat title"
                  className="min-w-0 flex-1"
                  value={editing.title}
                  maxLength={120}
                  disabled={pending}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setEditing({ id: chat.id, title: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && !pending) setEditing(null)
                  }}
                />
                <Button type="submit" size="xs" disabled={pending || !editing.title.trim()}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={pending}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start px-2 font-normal"
                  title={chat.title}
                  data-conversation-id={chat.id}
                  disabled={disabled || pending}
                  onClick={() => void onOpen(chat.id).catch(onError)}
                >
                  <ProviderLogo provider={chat.provider} />
                  <span className="truncate">{chat.title}</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Chat actions: ${chat.title}`}
                      disabled={disabled || pending}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onCloseAutoFocus={(event) => {
                      if (editing || deleting) event.preventDefault()
                    }}
                  >
                    <DropdownMenuItem
                      onSelect={() => setEditing({ id: chat.id, title: chat.title })}
                    >
                      <Pencil />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(chat)}>
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </li>
        ))}
      </ul>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(null)
        }}
      >
        <AlertDialogContent size="sm" className="gap-5 p-5">
          <AlertDialogHeader className="place-items-start text-left">
            <AlertDialogTitle className="text-base">Delete chat?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              “{deleting?.title}” will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end group-data-[size=sm]/alert-dialog-content:flex">
            <AlertDialogCancel size="sm" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                if (deleting)
                  void run(
                    () => onDelete(deleting.id),
                    () => setDeleting(null)
                  )
              }}
            >
              {pending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </nav>
  )
}
