import { createContext, memo, useContext, type ComponentProps } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { DocumentSource } from '../../../../shared/ai'
import { rehypeStreamText } from './rehypeStreamText'

type CitationProps = {
  sources?: DocumentSource[]
  stale?: boolean
  onCitation?(source: DocumentSource): void
}

const CitationContext = createContext<CitationProps>({})

function ChatLink({ href, children }: ComponentProps<'a'>): React.JSX.Element {
  const { sources, stale, onCitation } = useContext(CitationContext)
  if (href?.startsWith('#source/')) {
    const source = sources?.find((source) => source.id === href.slice(8))
    return source && onCitation ? (
      <button
        className="chat-source inline cursor-pointer rounded-[4px] border border-border bg-muted px-[5px] py-px text-[11px] font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50"
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
}

const markdownComponents = {
  a: ChatLink,
  img: () => <span>[External image omitted]</span>
}

/** Renders chat Markdown with safe external links and optional document citations. */
export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  sources,
  streaming = false,
  stale = false,
  onCitation
}: CitationProps & {
  text: string
  streaming?: boolean
}): React.JSX.Element {
  const content = sources
    ? text.replace(/\[\[([a-zA-Z0-9_-]+)\]\]/g, (_match, id: string) => {
        const source = sources.find((source) => source.id === id)
        return source && onCitation
          ? `[p. ${source.page}](#source/${id})`
          : '(reference unavailable)'
      })
    : text
  return (
    <CitationContext.Provider value={{ sources, stale, onCitation }}>
      <div
        className="chat-markdown text-sm leading-[1.65] group-data-[align=end]/message:whitespace-pre-wrap
          [&>:first-child]:mt-0 [&>:last-child]:mb-0
          [&_:is(p,ul,ol,pre,blockquote)]:my-[0.65em]
          [&_ul]:list-disc [&_ul]:pl-[1.5em] [&_ol]:list-decimal [&_ol]:pl-[1.5em]
          [&_:is(h1,h2,h3,h4)]:mt-[1em] [&_:is(h1,h2,h3,h4)]:mb-[0.4em] [&_:is(h1,h2,h3,h4)]:text-[1em] [&_:is(h1,h2,h3,h4)]:font-semibold
          [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:rounded-[6px] [&_pre]:bg-muted [&_pre]:p-2.5
          [&_code]:text-[0.9em] [&_code]:[font-family:monospace]
          [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2.5 [&_blockquote]:text-muted-foreground
          [&_a]:text-primary [&_a]:underline
          [&_table]:block [&_table]:max-w-full [&_table]:border-collapse [&_table]:overflow-x-auto
          [&_:is(td,th)]:border [&_:is(td,th)]:border-border [&_:is(td,th)]:px-2 [&_:is(td,th)]:py-[5px] [&_:is(td,th)]:text-left
          [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden"
      >
        <Markdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={streaming ? [rehypeKatex, rehypeStreamText] : [rehypeKatex]}
          skipHtml
          urlTransform={(url) =>
            url.startsWith('https://') || (onCitation && url.startsWith('#source/')) ? url : ''
          }
          components={markdownComponents}
        >
          {content}
        </Markdown>
      </div>
    </CitationContext.Provider>
  )
})
