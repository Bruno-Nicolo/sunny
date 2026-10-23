import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Pencil, RotateCcw, Split } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChatActivity } from './ChatActivity'
import { ChatMarkdown } from './ChatMarkdown'
import type { AiProvider, ChatMessage, DocumentSource } from '../../../../shared/ai'
import { formatChatMessageTime, formatChatMessageTimeTitle } from '../../../../shared/chat-time'

type Props = {
  message: ChatMessage
  provider: AiProvider
  stale: boolean
  retry: boolean
  editable: boolean
  forkable: boolean
  onEdit(text: string): Promise<boolean>
  onFork(): void
  onCitation(source: DocumentSource): void
  onRetry(): void
  onError(message: string): void
}

export function ChatMessageView({
  message,
  provider,
  stale,
  retry,
  editable,
  forkable,
  onEdit,
  onFork,
  onCitation,
  onRetry,
  onError
}: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(message.text)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timestamp = formatChatMessageTime(message.createdAt)
  const timestampTitle = formatChatMessageTimeTitle(message.createdAt)
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    []
  )
  const copyMessage = (): void => {
    const text =
      message.role === 'assistant'
        ? message.text.replace(/\[\[([a-zA-Z0-9_-]+)\]\]/g, (_match, id: string) => {
            const source = message.sources.find((source) => source.id === id)
            return source ? `(p. ${source.page})` : '(reference unavailable)'
          })
        : message.text
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        if (copyTimer.current) clearTimeout(copyTimer.current)
        copyTimer.current = setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => onError('The message could not be copied.'))
  }
  return (
    <Message
      align={message.role === 'user' ? 'end' : 'start'}
      className="chat-message select-text wrap-anywhere"
      aria-label={message.role === 'user' ? 'Your message' : 'AI answer'}
    >
      <MessageContent>
        {message.role === 'assistant' && message.work && (
          <ChatActivity
            work={message.work}
            running={message.status === 'streaming'}
            provider={provider}
            model={message.model}
          />
        )}
        {message.attachments.length > 0 && (
          <div
            className={`flex max-w-[90%] flex-wrap gap-2 ${message.role === 'user' ? 'self-end justify-end' : ''}`}
          >
            {message.attachments.map((attachment) => (
              <button
                key={attachment.id}
                className="chat-saved-selection max-w-40 rounded-[6px] border border-border p-[5px] text-left text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_img]:mb-1 [&_img]:max-h-20 [&_img]:object-contain [&_span]:block"
                disabled={stale}
                title={attachment.text || `Region on page ${attachment.page}`}
                onClick={() => onCitation(attachment)}
              >
                {attachment.image && (
                  <img src={attachment.image} alt={`Selected region on page ${attachment.page}`} />
                )}
                <span>
                  Page {attachment.page}
                  {attachment.kind === 'text' ? ' · Text' : ' · Region'}
                </span>
                {!attachment.image && (
                  <span className="line-clamp-2 text-muted-foreground">{attachment.text}</span>
                )}
              </button>
            ))}
          </div>
        )}
        <Bubble
          align={message.role === 'user' ? 'end' : 'start'}
          variant={message.role === 'user' ? 'muted' : 'ghost'}
          className={message.role === 'user' ? 'max-w-[90%]' : 'w-full'}
        >
          <BubbleContent
            className={
              message.role === 'user' ? 'rounded-2xl px-4 py-2.5' : 'w-full overflow-visible'
            }
          >
            {editing ? (
              <form
                className="min-w-0 space-y-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!editable || saving || (!editText.trim() && !message.attachments.length))
                    return
                  setSaving(true)
                  setEditing(false)
                  void onEdit(editText)
                    .then((accepted) => {
                      if (!accepted) setEditing(true)
                    })
                    .finally(() => setSaving(false))
                }}
              >
                <Textarea
                  autoFocus
                  aria-label="Message text"
                  value={editText}
                  maxLength={16000}
                  disabled={saving}
                  onChange={(event) => setEditText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && !saving) setEditing(false)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Sending replaces this message and removes all later messages.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      !editable || saving || (!editText.trim() && !message.attachments.length)
                    }
                  >
                    Save & send
                  </Button>
                </div>
              </form>
            ) : (
              <ChatMarkdown
                text={saving ? editText : message.text}
                streaming={message.status === 'streaming'}
                sources={message.sources}
                stale={stale}
                onCitation={onCitation}
              />
            )}
          </BubbleContent>
        </Bubble>
        {message.role === 'user' && !editing && (
          <MessageFooter className="pointer-events-none justify-end gap-0.5 px-0 opacity-0 transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100">
            <time
              dateTime={new Date(message.createdAt).toISOString()}
              title={timestampTitle}
              className="mr-1 text-[11px] font-normal"
            >
              {timestamp}
            </time>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-7 [&_svg:not([class*='size-'])]:size-3.5"
                  aria-label={copied ? 'Message copied' : 'Copy message'}
                  onClick={copyMessage}
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copied ? 'Copied' : 'Copy message'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-7 [&_svg:not([class*='size-'])]:size-3.5"
                  aria-label="Edit message"
                  disabled={!editable}
                  onClick={() => {
                    setEditText(message.text)
                    setEditing(true)
                  }}
                >
                  <Pencil />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit message</TooltipContent>
            </Tooltip>
          </MessageFooter>
        )}
        {message.status === 'stopped' && (
          <p className="mt-2 text-xs text-muted-foreground">Response interrupted.</p>
        )}
        {message.status === 'error' && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {message.error}
          </p>
        )}
        {message.role === 'assistant' && message.status !== 'streaming' && (
          <MessageFooter className="pointer-events-none gap-0.5 px-0 opacity-0 transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100">
            <div className="flex gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-7 [&_svg:not([class*='size-'])]:size-3.5"
                    aria-label={copied ? 'Answer copied' : 'Copy answer'}
                    onClick={copyMessage}
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copied ? 'Copied' : 'Copy answer'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-7 [&_svg:not([class*='size-'])]:size-3.5"
                    aria-label="Fork conversation"
                    disabled={!forkable}
                    onClick={onFork}
                  >
                    <Split />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Fork conversation from here</TooltipContent>
              </Tooltip>
              {retry && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-7 [&_svg:not([class*='size-'])]:size-3.5"
                      aria-label="Retry"
                      onClick={onRetry}
                    >
                      <RotateCcw />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Retry response</TooltipContent>
                </Tooltip>
              )}
            </div>
            <time
              className="ml-2 shrink-0 text-[11px] font-normal text-muted-foreground/70"
              dateTime={new Date(message.createdAt).toISOString()}
              title={timestampTitle}
            >
              {timestamp}
            </time>
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}
