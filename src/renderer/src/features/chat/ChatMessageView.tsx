import { Copy, RotateCcw } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Button } from '@/components/ui/button'
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
  const content = message.text.replace(/\[\[([a-zA-Z0-9_-]+)\]\]/g, (_match, id: string) => {
    const source = message.sources.find((source) => source.id === id)
    return source ? `[p. ${source.page}](#source/${id})` : '(reference unavailable)'
  })
  return (
    <article
      className={`chat-message ${message.role === 'user' ? 'chat-message-user' : ''}`}
      aria-label={message.role === 'user' ? 'Your message' : 'AI answer'}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{message.role === 'user' ? 'You' : 'Assistant'}</span>
        {message.role === 'assistant' && (
          <span className="truncate" title={message.model}>
            {message.model}
          </span>
        )}
      </div>
      {message.attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {message.attachments.map((attachment) => (
            <button
              key={attachment.id}
              className="chat-saved-selection"
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
      <div className="chat-markdown">
        <Markdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          skipHtml
          urlTransform={(url) =>
            url.startsWith('#source/') || url.startsWith('https://') ? url : ''
          }
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith('#source/')) {
                const source = message.sources.find((source) => source.id === href.slice(8))
                return source ? (
                  <button
                    className="chat-source"
                    disabled={stale}
                    title={stale ? 'This citation belongs to an older PDF version.' : source.text}
                    onClick={() => onCitation(source)}
                  >
                    {children}
                  </button>
                ) : (
                  <span>(reference unavailable)</span>
                )
              }
              return (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              )
            },
            img: () => <span>[External image omitted]</span>
          }}
        >
          {content}
        </Markdown>
      </div>
      {message.status === 'stopped' && (
        <p className="mt-2 text-xs text-muted-foreground">Response interrupted.</p>
      )}
      {message.status === 'error' && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {message.error}
        </p>
      )}
      {message.role === 'assistant' && message.status !== 'streaming' && (
        <div className="mt-2 flex gap-1">
          <Button
            variant="ghost"
            size="xs"
            aria-label="Copy answer"
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  message.text.replace(/\[\[([a-zA-Z0-9_-]+)\]\]/g, (_match, id: string) => {
                    const source = message.sources.find((source) => source.id === id)
                    return source ? `(p. ${source.page})` : '(reference unavailable)'
                  })
                )
                .catch(() => onError('The answer could not be copied.'))
            }}
          >
            <Copy />
            Copy
          </Button>
          {retry && (
            <Button variant="ghost" size="xs" onClick={onRetry}>
              <RotateCcw />
              Retry
            </Button>
          )}
        </div>
      )}
    </article>
  )
}
