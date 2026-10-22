import { useEffect, useRef, useState } from 'react'
import { Check, Copy, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChatActivity } from './ChatActivity'
import { ChatMarkdown } from './ChatMarkdown'
import type { ChatMessage, DocumentSource } from '../../../../shared/ai'

type Props = {
  message: ChatMessage
  stale: boolean
  retry: boolean
  onCitation(source: DocumentSource): void
  onRetry(): void
  onError(message: string): void
}

export function ChatMessageView({
  message,
  stale,
  retry,
  onCitation,
  onRetry,
  onError
}: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    []
  )
  return (
    <Message
      align={message.role === 'user' ? 'end' : 'start'}
      className="chat-message select-text wrap-anywhere"
      aria-label={message.role === 'user' ? 'Your message' : 'AI answer'}
    >
      <MessageContent>
        {message.role === 'assistant' && message.work && (
          <ChatActivity work={message.work} running={message.status === 'streaming'} />
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
            <ChatMarkdown
              text={message.text}
              streaming={message.status === 'streaming'}
              sources={message.sources}
              stale={stale}
              onCitation={onCitation}
            />
          </BubbleContent>
        </Bubble>
        {message.status === 'stopped' && (
          <p className="mt-2 text-xs text-muted-foreground">Response interrupted.</p>
        )}
        {message.status === 'error' && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {message.error}
          </p>
        )}
        {message.role === 'assistant' && message.status !== 'streaming' && (
          <MessageFooter className="gap-0.5 px-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={copied ? 'Answer copied' : 'Copy answer'}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(
                        message.text.replace(/\[\[([a-zA-Z0-9_-]+)\]\]/g, (_match, id: string) => {
                          const source = message.sources.find((source) => source.id === id)
                          return source ? `(p. ${source.page})` : '(reference unavailable)'
                        })
                      )
                      .then(() => {
                        setCopied(true)
                        if (copyTimer.current) clearTimeout(copyTimer.current)
                        copyTimer.current = setTimeout(() => setCopied(false), 2000)
                      })
                      .catch(() => onError('The answer could not be copied.'))
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copied ? 'Copied' : 'Copy answer'}</TooltipContent>
            </Tooltip>
            {retry && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Retry" onClick={onRetry}>
                    <RotateCcw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Retry response</TooltipContent>
              </Tooltip>
            )}
            <span className="ml-2 truncate text-xs text-muted-foreground/70" title={message.model}>
              {message.model}
            </span>
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}
