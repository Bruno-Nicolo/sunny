import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/renderer/src/features/documents/draftAutosave.ts', import.meta.url),
  'utf8'
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
})
const { createDraftAutosave } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function fixture(snapshot = async () => ({ hash: 'one', data: new Uint8Array([1]) })) {
  const tab = {
    id: 'tab',
    path: 'original.pdf',
    dirty: true,
    view: { pages: 1 },
    data: new ArrayBuffer(1),
    mtimeMs: 42,
    size: 100
  }
  const writes = [],
    errors = []
  const controller = createDraftAutosave()
  const options = {
    getTabs: () => [tab],
    getViewer: () => ({ snapshotDocument: snapshot }),
    save: async (draft) => {
      writes.push(draft)
    },
    onError: (message) => errors.push(message)
  }
  const autosave = { ...controller, tick: () => controller.tick(options) }
  return { tab, writes, errors, autosave, options }
}

test('autosave passes the last persisted annotation hash and skips unchanged snapshots', async () => {
  const previous = []
  const snapshots = [
    { hash: 'one', data: new Uint8Array([1]) },
    null,
    { hash: 'two', data: new Uint8Array([2]) }
  ]
  const { tab, writes, autosave } = fixture(async (hash) => {
    previous.push(hash)
    return snapshots.shift()
  })
  await autosave.tick()
  await autosave.tick()
  await autosave.tick()
  assert.deepEqual(previous, [undefined, 'one', 'one'])
  assert.equal(writes.length, 2)
  assert.equal(writes[0].mtimeMs, 42)
  assert.equal(tab.dirty, true)
  tab.dirty = false
  await autosave.tick()
  assert.equal(previous.length, 3)
})

test('paused operations cancel pending snapshots and resume after failure', async () => {
  const pending = deferred()
  const operation = deferred()
  const { autosave, writes } = fixture(() => pending.promise)
  const tick = autosave.tick()
  const paused = autosave.withPaused(['tab'], () => operation.promise)
  pending.resolve({ hash: 'one', data: new Uint8Array([1]) })
  await tick
  await autosave.tick()
  assert.equal(writes.length, 0)
  operation.resolve()
  await paused
  await autosave.tick()
  assert.equal(writes.length, 1)
  await assert.rejects(
    autosave.withPaused(['tab'], async () => {
      throw new Error('Save failed')
    }),
    /Save failed/
  )
  await autosave.tick()
  assert.equal(writes.length, 2)
})

test('overlapping operations keep snapshots paused until both finish', async () => {
  const first = deferred(),
    second = deferred()
  const { autosave, writes } = fixture()
  const one = autosave.withPaused(['tab'], () => first.promise)
  const two = autosave.withPaused(['tab'], () => second.promise)
  first.resolve()
  await one
  await autosave.tick()
  assert.equal(writes.length, 0)
  second.resolve()
  await two
  await autosave.tick()
  assert.equal(writes.length, 1)
})

test('failed snapshots warn once, retry, and preserve the dirty document', async () => {
  let fail = true
  const { autosave, errors, writes, tab } = fixture(async () => {
    if (fail) throw new Error('Disk error')
    return { hash: 'one', data: new Uint8Array([1]) }
  })
  await autosave.tick()
  await autosave.tick()
  assert.equal(errors.length, 1)
  assert.equal(tab.dirty, true)
  fail = false
  await autosave.tick()
  assert.equal(writes.length, 1)
})

test('a failed disk write retries the same hash instead of marking it persisted', async () => {
  const previous = []
  const { options, autosave } = fixture(async (hash) => {
    previous.push(hash)
    return { hash: 'one', data: new Uint8Array([1]) }
  })
  let fail = true
  options.save = async () => {
    if (fail) throw new Error('Disk full')
  }
  await autosave.tick()
  fail = false
  await autosave.tick()
  assert.deepEqual(previous, [undefined, undefined])
})

test('successful copies in another tab do not repeat an existing failure warning', async () => {
  const { tab, options, errors, autosave } = fixture()
  const other = { ...tab, id: 'other', path: 'other.pdf' }
  options.getTabs = () => [tab, other]
  options.getViewer = (id) => ({
    snapshotDocument: async () => {
      if (id === tab.id) throw new Error('Cannot save first document')
      return { hash: 'other', data: new Uint8Array([2]) }
    }
  })
  await autosave.tick()
  await autosave.tick()
  assert.equal(errors.length, 1)
})
