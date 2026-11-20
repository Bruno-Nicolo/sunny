import { createContext, memo, useContext, useMemo, type ComponentProps } from 'react'
import { BrainIcon } from 'lucide-react'
import Markdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { Root } from 'hast'
import type { DocumentSource } from '../../../../shared/ai'
import { rehypeStreamText } from './rehypeStreamText'
import { remarkLatexMath } from './remarkLatexMath'

type CitationProps = {
  sources?: DocumentSource[]
  stale?: boolean
  onCitation?(source: DocumentSource): void
}

const CitationContext = createContext<{
  sources?: Map<string, DocumentSource>
  stale: boolean
  onCitation?: CitationProps['onCitation']
}>({ stale: false })

const remarkPlugins = [remarkGfm, remarkMath, remarkLatexMath]
const rehypePlugins = [rehypeKatex]
const streamingRehypePlugins = [rehypeKatex, rehypeStreamText]

function rehypeReasoningBlocks(): (tree: Root) => void {
  return (tree) => {
    tree.children = tree.children.map((child) =>
      child.type === 'element'
        ? {
            type: 'element',
            tagName: 'div',
            properties: { dataReasoningBlock: 'true' },
            children: [child]
          }
        : child
    )
  }
}

function ChatLink({ href, children }: ComponentProps<'a'>): React.JSX.Element {
  const { sources, stale, onCitation } = useContext(CitationContext)
  if (href?.startsWith('#source/')) {
    const source = sources?.get(href.slice(8))
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

const reasoningComponents = {
  ...markdownComponents,
  div: ({ node, children, ...props }: ComponentProps<'div'> & ExtraProps) =>
    node?.properties.dataReasoningBlock === 'true' ? (
      <div className="my-[0.65em] grid grid-cols-[0.875rem_minmax(0,1fr)] items-start gap-2 [&>:last-child]:my-0">
        <BrainIcon className="mt-1 size-3.5 text-muted-foreground" aria-hidden />
        {children}
      </div>
    ) : (
      <div {...props}>{children}</div>
    )
}

/** Renders chat Markdown with safe external links and optional document citations. */
export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  sources,
  streaming = false,
  reasoning = false,
  stale = false,
  onCitation
}: CitationProps & {
  text: string
  streaming?: boolean
  reasoning?: boolean
}): React.JSX.Element {
  const sourceIndex = useMemo(
    () => (sources ? new Map(sources.map((source) => [source.id, source])) : undefined),
    [sources]
  )
  const canCite = Boolean(onCitation)
  const content = useMemo(
    () =>
      sourceIndex
        ? text.replace(/\[\[([a-zA-Z0-9_-]+)\]\]/g, (_match, id: string) => {
            const source = sourceIndex.get(id)
            return source && canCite
              ? `[p. ${source.page}](#source/${id})`
              : '(reference unavailable)'
          })
        : text,
    [text, sourceIndex, canCite]
  )
  const citations = useMemo(
    () => ({ sources: sourceIndex, stale, onCitation }),
    [sourceIndex, stale, onCitation]
  )
  const plugins = streaming ? streamingRehypePlugins : rehypePlugins
  const markdown = useMemo(
    () => (
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={reasoning ? [...plugins, rehypeReasoningBlocks] : plugins}
        skipHtml
        urlTransform={(url) =>
          url.startsWith('https://') || (canCite && url.startsWith('#source/')) ? url : ''
        }
        components={reasoning ? reasoningComponents : markdownComponents}
      >
        {content}
      </Markdown>
    ),
    [content, plugins, canCite, reasoning]
  )
  return (
    <CitationContext.Provider value={citations}>
      <div
        className="chat-markdown text-[length:var(--chat-font-size,14px)] leading-[1.65] group-data-[align=end]/message:whitespace-pre-wrap
          [&>:first-child]:mt-0 [&>:last-child]:mb-0
          [&_:is(p,ul,ol,pre,blockquote)]:my-[0.65em]
          [&_ul]:list-disc [&_ul]:pl-[1.5em] [&_ol]:list-decimal [&_ol]:pl-[1.5em]
          [&_:is(h1,h2,h3,h4)]:mt-[1em] [&_:is(h1,h2,h3,h4)]:mb-[0.4em] [&_:is(h1,h2,h3,h4)]:text-[1em] [&_:is(h1,h2,h3,h4)]:font-semibold
          [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:rounded-[6px] [&_pre]:bg-muted [&_pre]:p-2.5
          [&_code]:text-[0.9em] [&_code]:[font-family:monospace]
          [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2.5 [&_blockquote]:text-muted-foreground
          [&_a]:text-primary [&_a]:underline
          [&_table]:block [&_table]:max-w-full [&_table]:border-collapse [&_table]:overflow-x-auto
          [&_:is(td,th)]:border [&_:is(td,th)]:border-border [&_:is(td,th)]:px-2 [&_:is(td,th)]:py-[5px] [&_:is(td,th)]:text-left"
      >
        {markdown}
      </div>
    </CitationContext.Provider>
  )
})
