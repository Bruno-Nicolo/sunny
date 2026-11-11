import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const [source, draftSource] = await Promise.all([
  readFile(new URL('../src/renderer/src/features/pdf/pageOperations.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/src/features/pdf/pageDraft.ts', import.meta.url), 'utf8')
])
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const operationsUrl = moduleUrl(compile(source))
const { createPageDraft, pageDraftReducer: reduce } = await import(
  moduleUrl(compile(draftSource).replace("'./pageOperations'", JSON.stringify(operationsUrl)))
)
const { movePages, retainedPage, validatePageOrder, findPageDropBefore } = await import(
  operationsUrl
)

test('moving disjoint pages groups them in their visible order in either direction', () => {
  assert.deepEqual(movePages([0, 1, 2, 3, 4], new Set([3, 1]), 0), [1, 3, 0, 2, 4])
  assert.deepEqual(movePages([0, 1, 2, 3, 4], new Set([0, 2]), null), [1, 3, 4, 0, 2])
  assert.deepEqual(movePages([4, 3, 2, 1, 0], new Set([0, 4]), 1), [3, 2, 4, 0, 1])
  assert.deepEqual(movePages([0, 1, 2], new Set([1]), 1), [0, 1, 2])
})

test('the reading position follows the original page or the next surviving page', () => {
  assert.equal(retainedPage([3, 0, 2, 1], 1), 2)
  assert.equal(retainedPage([3, 0, 2], 2), 3)
  assert.equal(retainedPage([1, 0], 4), 1)
  assert.equal(retainedPage([2], 1), 1)
})

test('page operations reject empty, duplicate, fractional and out-of-range selections', () => {
  for (const order of [[], [1, 1], [-1], [3], [0.5]])
    assert.throws(() => validatePageOrder(order, 3))
  assert.doesNotThrow(() => validatePageOrder([2, 0], 3))
})

test('drop boundaries distinguish left/right halves, row wrapping and document ends', () => {
  const cells = [
    { page: 4, left: 0, right: 100, top: 0, bottom: 150 },
    { page: 7, left: 110, right: 210, top: 0, bottom: 150 },
    { page: 9, left: 0, right: 100, top: 160, bottom: 310 }
  ]
  assert.equal(findPageDropBefore(cells, { x: 10, y: 50 }), 4)
  assert.equal(findPageDropBefore(cells, { x: 90, y: 50 }), 7)
  assert.equal(findPageDropBefore(cells, { x: 200, y: 50 }), 9)
  assert.equal(findPageDropBefore(cells, { x: 10, y: 200 }), 9)
  assert.equal(findPageDropBefore(cells, { x: 90, y: 200 }), null)
  assert.equal(findPageDropBefore(cells, { x: 10, y: 400 }), null)
  assert.equal(findPageDropBefore([], { x: 10, y: 50 }), null)
})

test('range selection follows visible order and keeps page identities through reordering', () => {
  let state = reduce(createPageDraft(5), { type: 'toggle-selection' })
  state = reduce(state, { type: 'reorder', order: [4, 2, 0, 3, 1] })
  state = reduce(state, { type: 'select', page: 2, range: false })
  state = reduce(state, { type: 'select', page: 3, range: true })
  assert.deepEqual([...state.selected], [2, 0, 3])
  state = reduce(state, { type: 'reorder', order: [1, 3, 0, 2, 4] })
  assert.deepEqual([...state.selected], [2, 0, 3])
  state = reduce(state, { type: 'delete-selected' })
  assert.deepEqual(state.order, [1, 4])
  assert.equal(state.selected.size, 0)
  assert.equal(state.anchor, null)
})

test('reset restores pages, and leaving selection clears its anchor without losing the draft', () => {
  let state = reduce(createPageDraft(4), { type: 'toggle-selection' })
  state = reduce(state, { type: 'select', page: 1, range: false })
  state = reduce(state, { type: 'delete-selected' })
  state = reduce(state, { type: 'toggle-selection' })
  assert.equal(state.selecting, false)
  assert.deepEqual(state.order, [0, 2, 3])
  assert.equal(state.anchor, null)
  state = reduce(state, { type: 'reset', count: 4, selecting: true })
  assert.deepEqual(state.order, [0, 1, 2, 3])
  assert.equal(state.selecting, true)
  assert.equal(state.selected.size, 0)
})

test('the draft rejects deleting all pages and ignores reorders that leave the order unchanged', () => {
  let state = createPageDraft(3)
  assert.equal(reduce(state, { type: 'reorder', order: [0, 1, 2] }), state)
  state = reduce(state, { type: 'select-all' })
  assert.equal(reduce(state, { type: 'delete-selected' }), state)
})
