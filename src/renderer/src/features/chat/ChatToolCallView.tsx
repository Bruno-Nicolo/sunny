import { memo } from 'react'
import { FileSearch, FileText, Wrench, X } from 'lucide-react'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '@/components/ui/trace'
import type { ChatToolCall } from '../../../../shared/ai'

/** Shows the invocation status and details available in the stream. */
export const ChatToolCallView = memo(function ChatToolCallView({
  tool
}: {
  tool: ChatToolCall
}): React.JSX.Element {
  const running = tool.status === 'running'
  const reading = tool.name === 'read_document'
  const searching = tool.name === 'search_document'
  const Icon = reading ? FileText : searching ? FileSearch : Wrench
  const label = reading ? 'Read document' : searching ? 'Search document' : tool.name
  return (
    <Trace aria-label={`Tool call: ${tool.name}`} aria-busy={running}>
      <TraceCollapsible defaultOpen={false}>
        <TraceCollapsibleTrigger aria-label={`Show tool call: ${tool.name}`}>
          <TraceLine status={running ? 'running' : undefined}>
            <TraceIcon className="size-3.5">
              <Icon className="size-3.5" />
            </TraceIcon>
            <TraceTitle>
              {label}
              {tool.status === 'requested' && ' · Requested'}
              {tool.status === 'stopped' && ' · Stopped'}
            </TraceTitle>
            {tool.status === 'error' && (
              <span role="img" aria-label="Tool failed" className="shrink-0 text-destructive">
                <X aria-hidden="true" className="size-3.5" />
              </span>
            )}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="space-y-3 text-xs">
          <div className="space-y-1">
            <p className="font-medium">Input</p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px]">
              {typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>
          {tool.output !== undefined && (
            <div className="space-y-1">
              <p className="font-medium">Output</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px]">
                {tool.output}
              </pre>
            </div>
          )}
          {tool.error && (
            <p role="alert" className="text-destructive">
              {tool.error}
            </p>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
})
