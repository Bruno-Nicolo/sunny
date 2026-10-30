import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown'
import type { Extension, State, Tokenizer } from 'micromark-util-types'
import type { Plugin } from 'unified'

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    latexMath: 'latexMath'
    latexMathData: 'latexMathData'
    latexMathMarker: 'latexMathMarker'
  }
}

const tokenize: Tokenizer = function (effects, ok, nok) {
  let closing: number
  let inData = false
  return start

  function start(code: number | null): State | undefined {
    effects.enter('latexMath')
    effects.enter('latexMathMarker')
    effects.consume(code)
    return opening
  }

  function body(code: number | null): State | undefined {
    if (code === null) return nok(code)
    if (code === -5 || code === -4 || code === -3) {
      if (inData) effects.exit('latexMathData')
      inData = false
      effects.enter('lineEnding')
      effects.consume(code)
      effects.exit('lineEnding')
      return body
    }
    if (!inData) effects.enter('latexMathData')
    inData = true
    effects.consume(code)
    return code === 92 ? escape : body
  }

  function escape(code: number | null): State | undefined {
    if (code === closing) {
      effects.consume(code)
      effects.exit('latexMathData')
      effects.exit('latexMath')
      return ok
    }
    if (code === null) return nok(code)
    if (code === -5 || code === -4 || code === -3) return body(code)
    effects.consume(code)
    return body
  }

  function opening(code: number | null): State | undefined {
    if (code !== 40 && code !== 91) return nok(code)
    closing = code === 40 ? 41 : 93
    effects.consume(code)
    effects.exit('latexMathMarker')
    return body
  }
}

const syntax: Extension = { text: { 92: { name: 'latexMath', tokenize } } }
const fromMarkdown: FromMarkdownExtension = {
  enter: {
    latexMath(token) {
      const source = this.sliceSerialize(token)
      const value = source.slice(2, -2).trim()
      this.enter(
        {
          type: 'inlineCode',
          value,
          data: {
            hName: 'code',
            hProperties: {
              className: ['language-math', source[1] === '[' ? 'math-display' : 'math-inline']
            },
            hChildren: [{ type: 'text', value }]
          }
        },
        token
      )
    }
  },
  exit: {
    latexMath(token) {
      this.exit(token)
    }
  }
}

/** Adds LaTeX parenthesis and bracket delimiters without interpreting Markdown code examples. */
export const remarkLatexMath: Plugin = function () {
  const data = this.data() as {
    micromarkExtensions?: Extension[]
    fromMarkdownExtensions?: FromMarkdownExtension[]
  }
  const syntaxExtensions = (data.micromarkExtensions ??= [])
  const treeExtensions = (data.fromMarkdownExtensions ??= [])
  syntaxExtensions.push(syntax)
  treeExtensions.push(fromMarkdown)
}
