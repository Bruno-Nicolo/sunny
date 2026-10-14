import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/renderer/src/features/documents/documentsReducer.ts', import.meta.url),
  'utf8'
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
})
const {
  createTab,
  documentsReducer: reduce,
  initialDocumentsState
} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

function pdf(path) {
  return {
    path,
    name: path,
    directoryName: 'test',
    data: new Uint8Array([1]).buffer,
    mtimeMs: 1,
    size: 1
  }
}

function tab(path) {
  return createTab(pdf(path))
}

test('concurrent openings of the same path keep the original viewer, edits, and tab identity', () => {
  const first = tab('first.pdf')
  first.dirty = true
  const second = tab('second.pdf')
  let state = reduce(initialDocumentsState, { type: 'open', tabs: [first, second] })
  state = reduce(state, { type: 'open', tabs: [tab(first.path), tab(first.path)] })
  assert.deepEqual(state.tabs, [first, second])
  assert.equal(state.activeId, first.id)
})

test('a delayed close preserves documents opened and selected in the meantime', () => {
  const first = tab('first.pdf')
  const second = tab('second.pdf')
  const third = tab('third.pdf')
  let state = reduce(initialDocumentsState, { type: 'open', tabs: [first, second] })
  state = reduce(state, { type: 'open', tabs: [third] })
  state = reduce(state, { type: 'close', id: second.id })
  assert.deepEqual(state.tabs, [first, third])
  assert.equal(state.activeId, third.id)
})

test('closing the active tab selects its neighbor and closing the final tab clears selection', () => {
  const tabs = ['first.pdf', 'second.pdf', 'third.pdf'].map(tab)
  let state = reduce(initialDocumentsState, { type: 'open', tabs })
  state = reduce(state, { type: 'select', id: tabs[1].id })
  state = reduce(state, { type: 'close', id: tabs[1].id })
  assert.equal(state.activeId, tabs[2].id)
  state = reduce(state, { type: 'close', id: tabs[2].id })
  assert.equal(state.activeId, tabs[0].id)
  state = reduce(state, { type: 'close', id: tabs[0].id })
  assert.deepEqual(state.tabs, [])
  assert.equal(state.activeId, null)
  assert.equal(reduce(state, { type: 'select', id: 'missing' }), state)
})

test('late session restore retains startup documents and their edits and selection', () => {
  const opened = tab('opened.pdf')
  opened.dirty = true
  const saved = tab('saved.pdf')
  const state = reduce(reduce(initialDocumentsState, { type: 'open', tabs: [opened] }), {
    type: 'restore',
    tabs: [saved, tab(opened.path)],
    activePath: saved.path
  })
  assert.deepEqual(state.tabs, [saved, opened])
  assert.equal(state.activeId, opened.id)
  assert.equal(state.ready, true)
})

test('restore selects the saved document or the first remaining document when it is missing', () => {
  const tabs = ['first.pdf', 'second.pdf'].map(tab)
  assert.equal(
    reduce(initialDocumentsState, {
      type: 'restore',
      tabs,
      activePath: tabs[1].path
    }).activeId,
    tabs[1].id
  )
  assert.equal(
    reduce(initialDocumentsState, {
      type: 'restore',
      tabs,
      activePath: 'missing.pdf'
    }).activeId,
    tabs[0].id
  )
  assert.equal(
    reduce(initialDocumentsState, {
      type: 'restore',
      tabs: [],
      activePath: 'missing.pdf'
    }).activeId,
    null
  )
})

test('reload and copy replacement retain viewer position and identity and clear stale errors', () => {
  const original = tab('original.pdf')
  original.view = { ...original.view, page: 3, scrollTop: 400, scale: 'page-fit' }
  original.dirty = true
  original.unavailable = true
  original.error = 'Old error'
  const copy = pdf('copy.pdf')
  const state = reduce(reduce(initialDocumentsState, { type: 'open', tabs: [original] }), {
    type: 'replace',
    id: original.id,
    pdf: copy
  })
  assert.equal(state.activeId, original.id)
  assert.equal(state.tabs[0].id, original.id)
  assert.deepEqual(state.tabs[0].view, original.view)
  assert.equal(state.tabs[0].path, copy.path)
  assert.equal(state.tabs[0].dirty, false)
  assert.equal(state.tabs[0].unavailable, false)
  assert.equal(state.tabs[0].error, null)
})

test('late save and update results never resurrect a closed tab', () => {
  const first = tab('first.pdf')
  let state = reduce(initialDocumentsState, { type: 'open', tabs: [first] })
  state = reduce(state, { type: 'close', id: first.id })
  state = reduce(state, { type: 'saved', id: first.id, stats: { mtimeMs: 2, size: 2 } })
  state = reduce(state, { type: 'update', id: first.id, changes: { dirty: true } })
  assert.deepEqual(state.tabs, [])
  assert.equal(state.activeId, null)
})

test('reordering preserves document identity, edits, position, and active selection', () => {
  const tabs = ['first.pdf', 'second.pdf', 'third.pdf'].map(tab)
  tabs[0].dirty = true
  tabs[0].view.scrollTop = 400
  const initial = reduce(initialDocumentsState, { type: 'open', tabs })
  const moved = reduce(initial, { type: 'reorder', id: tabs[0].id, index: 2 })
  assert.deepEqual(moved.tabs, [tabs[1], tabs[2], tabs[0]])
  assert.equal(moved.tabs[2], tabs[0])
  assert.equal(moved.activeId, initial.activeId)
  const closed = reduce(moved, { type: 'close', id: tabs[2].id })
  assert.equal(closed.activeId, tabs[0].id)
  assert.equal(reduce(moved, { type: 'reorder', id: 'missing', index: 0 }), moved)
  assert.equal(reduce(moved, { type: 'reorder', id: tabs[0].id, index: -1 }), moved)
  assert.equal(reduce(moved, { type: 'reorder', id: tabs[0].id, index: 3 }), moved)
})

test('recovery replaces a clean startup tab, remains dirty, and survives a late session restore', () => {
  const startup = tab('first.pdf')
  const recovered = {
    ...tab('first.pdf'),
    data: new Uint8Array([9]).buffer,
    dirty: true,
    mtimeMs: 42
  }
  let state = reduce(initialDocumentsState, { type: 'open', tabs: [startup] })
  state = reduce(state, {
    type: 'recover',
    tabs: [recovered, { ...tab('missing.pdf'), dirty: true, unavailable: true }]
  })
  state = reduce(state, { type: 'restore', tabs: [tab('first.pdf')], activePath: 'first.pdf' })
  assert.equal(state.tabs.length, 2)
  assert.equal(state.tabs[0].id, startup.id)
  assert.equal(state.tabs[0].dirty, true)
  assert.equal(state.tabs[0].mtimeMs, 42)
  assert.deepEqual(new Uint8Array(state.tabs[0].data), new Uint8Array([9]))
  assert.equal(state.tabs[1].unavailable, true)
})
