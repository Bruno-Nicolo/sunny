import { useEffect, useState } from 'react'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle
} from '@/components/ui/trace'
import type { ChatWork } from '../../../../shared/ai'
import { ChatMarkdown } from './ChatMarkdown'
import { ChatToolCallView } from './ChatToolCallView'

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

/** One disclosure for the complete, ordered reasoning and tool timeline of a response. */
export function ChatActivity({
  work,
  running
}: {
  work: ChatWork
  running: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
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
              <WorkingTitle durationMs={work.durationMs} />
            </TraceLine>
          </div>
        ) : (
          <TraceCollapsibleTrigger
            aria-label="Response activity"
            className="w-full justify-start rounded-none border-b pb-2 [&>[data-slot=trace-icon]]:opacity-100"
          >
            <TraceLine>
              <TraceTitle>{`Worked for ${durationLabel(work.durationMs)}`}</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
        )}
        <TraceCollapsibleContent className="space-y-4">
          {work.parts.map((part, index) =>
            part.type === 'reasoning' ? (
              <div
                key={`reasoning-${index}`}
                className="text-foreground"
                aria-label="Model reasoning"
                aria-busy={running && index === work.parts.length - 1}
              >
                <ChatMarkdown
                  text={part.text}
                  streaming={running && index === work.parts.length - 1}
                />
              </div>
            ) : (
              <ChatToolCallView key={part.tool.id} tool={part.tool} />
            )
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
