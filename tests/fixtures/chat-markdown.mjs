import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '../..')
fs.mkdirSync(path.join(root, 'out'), { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'out', 'markdown-test-'))
export const dispose = () => fs.rmSync(directory, { recursive: true, force: true })
for (const file of ['ChatMarkdown.tsx', 'rehypeStreamText.ts', 'remarkLatexMath.ts']) {
  const sourcePath = path.join(root, 'src/renderer/src/features/chat', file)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX
    }
  })
  fs.writeFileSync(
    path.join(directory, file.replace(/\.tsx?$/, '.mjs')),
    outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'")
  )
}
const { ChatMarkdown } = await import(pathToFileURL(path.join(directory, 'ChatMarkdown.mjs')))
export const render = (text, streaming = false) =>
  renderToStaticMarkup(React.createElement(ChatMarkdown, { text, streaming, sources: [] }))
