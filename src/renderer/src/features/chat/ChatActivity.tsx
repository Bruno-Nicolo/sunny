import { memo, useEffect, useState } from 'react'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle
} from '@/components/ui/trace'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AiProvider, ChatWork } from '../../../../shared/ai'
import { ChatMarkdown } from './ChatMarkdown'
import { ChatToolCallView } from './ChatToolCallView'
import { ProviderLogo } from './ProviderLogo'

function durationLabel(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds < 1) return '<1s'
  if (seconds < 60) return `${seconds}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours && `${hours}h`, minutes && `${minutes}m`, remainder && `${remainder}s`]
    .filter(Boolean)
    .join(' ')
}

function WorkingTitle({ durationMs }: { durationMs: number }): React.JSX.Element {
  const [elapsedMs, setElapsedMs] = useState(durationMs)
  useEffect(() => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      setElapsedMs(durationMs + Date.now() - startedAt)
    }, 1000)
    return () => clearInterval(timer)
  }, [durationMs])
  return (
    <TraceTitle className="tabular-nums">
      {`Working for ${elapsedMs < 1000 ? '0s' : durationLabel(elapsedMs)}`}
    </TraceTitle>
  )
}

/** One disclosure for the ordered activity of a response. */
export const ChatActivity = memo(function ChatActivity({
  work,
  running,
  provider,
  model
}: {
  work: ChatWork
  running: boolean
  provider: AiProvider
  model: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const modelLogo = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex size-4 shrink-0 items-center justify-center">
          <ProviderLogo provider={provider} className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{model}</TooltipContent>
    </Tooltip>
  )
  return (
    <Trace
      className="chat-activity [&_[data-slot=trace-line]]:text-xs/5"
      aria-label="Response work"
      aria-busy={running}
    >
      <TraceCollapsible open={running || open} onOpenChange={setOpen}>
        {running ? (
          <div className="border-b pb-2">
            <TraceLine status="running" role="status">
              {modelLogo}
              <WorkingTitle durationMs={work.durationMs} />
            </TraceLine>
          </div>
        ) : (
          <TraceCollapsibleTrigger
            aria-label="Response activity"
            className="w-full justify-start rounded-none border-b pb-2 [&>[data-slot=trace-icon]]:opacity-100"
          >
            <TraceLine>
              {modelLogo}
              <TraceTitle>{`Worked for ${durationLabel(work.durationMs)}`}</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
        )}
        <TraceCollapsibleContent className="space-y-4">
          {work.parts.map((part, index) => {
            if (part.type === 'tool')
              return <ChatToolCallView key={part.tool.id} tool={part.tool} />
            const reasoning = part.type === 'reasoning'
            const streaming = running && index === work.parts.length - 1
            return (
              <div
                key={reasoning ? `reasoning-${index}` : part.id}
                className={
                  reasoning
                    ? 'font-normal text-muted-foreground [&_.chat-markdown_:is(b,strong,h1,h2,h3,h4,h5,h6,th)]:font-normal [&_.chat-markdown_a]:text-muted-foreground'
                    : 'text-foreground'
                }
                aria-label={reasoning ? 'Model reasoning' : 'Assistant update'}
                aria-busy={streaming}
              >
                <ChatMarkdown reasoning={reasoning} text={part.text} streaming={streaming} />
              </div>
            )
          })}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
})
