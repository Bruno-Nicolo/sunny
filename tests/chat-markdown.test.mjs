import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
fs.mkdirSync(path.join(root, 'out'), { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'out', 'markdown-test-'))
after(() => fs.rmSync(directory, { recursive: true, force: true }))
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
const render = (text, streaming = false) =>
  renderToStaticMarkup(React.createElement(ChatMarkdown, { text, streaming, sources: [] }))
const formulaCount = (html) => (html.match(/class="katex"/g) ?? []).length

for (const streaming of [false, true]) {
  test(`LaTeX delimiters render inline and display formulas (streaming=${streaming})`, () => {
    const html = render(
      String.raw`Inline \(x_i^2 + \frac{a}{b}\), then \(E = mc^2\).

\[
\begin{aligned}
a &= b + c \\
x &= \sqrt{y}
\end{aligned}
\]

Also \[x^2\] on one line, plus $y_i$ and $$z_i$$.`,
      streaming
    )
    assert.equal(formulaCount(html), 6)
    assert.equal((html.match(/class="katex-display"/g) ?? []).length, 2)
    assert.ok(!html.includes('katex-error'))
    assert.ok(html.includes('\\frac{a}{b}'))
    assert.ok(html.includes('\\begin{aligned}'))
  })
}

test('LaTeX examples in inline, fenced and indented code stay literal', () => {
  for (const markdown of [
    '`\\(x_i\\)` and `\\[x_i\\]`',
    '```latex\n\\(x_i\\)\n\\[x_i\\]\n```',
    '~~~latex\n\\(x_i\\)\n\\[x_i\\]\n~~~',
    '    \\(x_i\\)\n    \\[x_i\\]'
  ]) {
    const html = render(markdown)
    assert.equal(formulaCount(html), 0)
    assert.ok(html.includes('\\(x_i\\)'))
    assert.ok(html.includes('\\[x_i\\]'))
  }
})

test('incomplete and escaped delimiters remain text', () => {
  for (const text of [String.raw`\(x_i`, String.raw`\[x_i`, String.raw`\\(x_i\\)`]) {
    assert.equal(formulaCount(render(text, true)), 0)
  }
})

test('formulas work in lists and block quotes without consuming surrounding Markdown', () => {
  const html = render(String.raw`- **Formula:** \(x_i\)
- Next item

> \[
> x = y
> \]

[Link](https://example.com) and \(\text{cost: \$5}\).`)
  assert.equal(formulaCount(html), 3)
  assert.ok(html.includes('<strong>Formula:</strong>'))
  assert.ok(html.includes('<li>Next item</li>'))
  assert.ok(html.includes('href="https://example.com"'))
  assert.ok(!html.includes('katex-error'))
})

test('line endings and escaped backslashes preserve multiline formula contents', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const source = String.raw`\[
\begin{aligned}
x &= y \\
z &= w
\end{aligned}
\]`.replaceAll('\n', ending)
    const html = render(source, true)
    assert.equal(formulaCount(html), 1)
    assert.ok(!html.includes('katex-error'))
  }
  assert.equal(formulaCount(render('\\[x\\\ny\\]')), 1)
})

test('streaming prefixes remain text until the formula is closed', () => {
  for (const formula of [
    String.raw`\(x_i^2\)`,
    String.raw`\[
\frac{a}{b}
\]`
  ]) {
    for (let length = 1; length <= formula.length; length++) {
      assert.equal(
        formulaCount(render(formula.slice(0, length), true)),
        length === formula.length ? 1 : 0
      )
    }
  }
})
