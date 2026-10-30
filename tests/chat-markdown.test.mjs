import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { render, dispose } from './fixtures/chat-markdown.mjs'

after(dispose)
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

test('streaming prefixes and escaped delimiters remain text until a formula is closed', () => {
  assert.equal(formulaCount(render(String.raw`\\(x_i\\)`, true)), 0)
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
