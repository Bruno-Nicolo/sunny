import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import { aiModules } from './fixtures/ai-modules.mjs'

const { outputText } = ts.transpileModule(
  fs.readFileSync('src/renderer/src/features/pdf/chatDocument.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
)
const module = { exports: {} }
const pdfjs = { AnnotationMode: { DISABLE: 0 }, version: 'test' }
new Function('require', 'module', 'exports', outputText)(
  (name) => {
    if (name === 'pdfjs-dist/legacy/build/pdf.mjs') return pdfjs
    if (name === './annotations/pageAnnotations') return {}
    throw new Error(`Unexpected import: ${name}`)
  },
  module,
  module.exports
)
const { prepareChatDocument } = module.exports

test('PDF index survives restart and invalidates when the file or engine changes', async (t) => {
  const modules = aiModules()
  const { AiService } = modules.load('service')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sunny-index-'))
  let service = new AiService(directory)
  const originalWindow = globalThis.window
  t.after(() => {
    globalThis.window = originalWindow
    service.dispose()
    service.store.close()
    modules.dispose()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  let renders = 0
  let writes = 0
  let text = 'Saved passage'
  const page = {
    pageNumber: 1,
    view: [0, 0, 10, 10],
    getTextContent: async () => ({
      items: [{ str: text, transform: [1, 0, 0, 1, 0, 0], width: 10, height: 1, fontName: 'f' }],
      styles: {}
    }),
    getViewport: () => ({ width: 10, height: 10 }),
    render: () => {
      renders++
      return { promise: Promise.resolve() }
    }
  }
  let bytes = new Uint8Array([1, 2, 3])
  const pdf = { numPages: 1, getData: async () => bytes, getPage: async () => page }
  globalThis.window = {
    lepis: {
      ai: {
        openDocument: (key, file) => service.openDocument(key, file),
        index: (document) => {
          writes++
          service.index(document)
        }
      }
    },
    document: {
      createElement: () => ({
        getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4) }) })
      })
    }
  }
  const file = { name: 'test.pdf', path: '/test.pdf' }
  const prepare = () =>
    prepareChatDocument(
      pdf,
      file,
      new AbortController().signal,
      () => {},
      () => {}
    )
  const first = await prepare()
  service.dispose()
  service.store.close()
  service = new AiService(directory)
  service.store.sources = () => {
    throw new Error('Cache hits must not load passages')
  }
  assert.deepEqual(await prepare(), first)
  assert.equal(renders, 1, 'restart must skip rendering previously indexed pages')
  assert.equal(writes, 1, 'cache hits must not resend or revalidate passages')
  bytes = new Uint8Array([1, 2, 4])
  const changed = await prepare()
  assert.equal(renders, 2, 'changed file bytes must be reindexed')
  assert.equal(changed.version, first.version, 'annotation-only changes preserve content identity')
  assert.deepEqual(await prepare(), changed)
  text = 'Changed passage'
  bytes = new Uint8Array([1, 2, 5])
  const newContent = await prepare()
  assert.notEqual(newContent.version, first.version)
  assert.equal(renders, 3)
  pdfjs.version = 'next'
  const newEngine = await prepare()
  assert.notEqual(newEngine.indexKey, newContent.indexKey)
  assert.equal(renders, 4, 'engine updates invalidate the cache')
})
