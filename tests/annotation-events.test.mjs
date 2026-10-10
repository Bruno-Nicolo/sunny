import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/renderer/src/features/pdf/annotations/editorEvents.ts', import.meta.url),
  'utf8'
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
})
const { createEditorEvents } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function fixture(t, onModeRequest = () => {}) {
  const lifetime = new AbortController()
  t.after(() => lifetime.abort())
  const listeners = new Map()
  const commands = []
  const requests = []
  const bus = {
    on(name, listener, { signal }) {
      if (signal.aborted) return
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(listener)
      signal.addEventListener('abort', () => bus.off(name, listener), { once: true })
    },
    off(name, listener) {
      listeners.get(name)?.delete(listener)
    },
    dispatch(name, payload) {
      commands.push({ name, payload })
      for (const listener of [...(listeners.get(name) ?? [])]) listener(payload)
    }
  }
  const viewer = {
    set annotationEditorMode(options) {
      requests.push(options)
      onModeRequest(options, bus)
    }
  }
  const events = createEditorEvents({ eventBus: bus, viewer, signal: lifetime.signal })
  return {
    events,
    bus,
    lifetime,
    requests,
    commands,
    modeListeners: () => listeners.get('annotationeditormodechanged').size
  }
}

test('annotation commands share the PDF.js event protocol and stop after disposal', (t) => {
  const { events, commands, requests, lifetime } = fixture(t)
  events.setParam(11, '#FF0000')
  events.runHistoryAction('undo')
  events.runHistoryAction('redo')
  assert.deepEqual(commands, [
    { name: 'switchannotationeditorparams', payload: { source: null, type: 11, value: '#FF0000' } },
    { name: 'editingaction', payload: { source: null, name: 'undo' } },
    { name: 'editingaction', payload: { source: null, name: 'redo' } }
  ])
  lifetime.abort()
  events.setParam(11, '#000000')
  events.runHistoryAction('undo')
  events.setMode({ mode: 3 })
  assert.equal(commands.length, 3)
  assert.deepEqual(requests, [])
})

test('mode requests await confirmation and reuse the confirmed mode', async (t) => {
  const { events, bus, requests, modeListeners } = fixture(t)
  const pending = events.enterMode(13)
  assert.deepEqual(requests, [{ mode: 13 }])
  assert.equal(modeListeners(), 2)
  bus.dispatch('annotationeditormodechanged', { mode: 13 })
  await pending
  assert.equal(modeListeners(), 1)
  await events.enterMode(13)
  assert.equal(requests.length, 1)
})

test('synchronous confirmation and concurrent requests release temporary listeners', async (t) => {
  const sync = fixture(t, ({ mode }, bus) => bus.dispatch('annotationeditormodechanged', { mode }))
  await sync.events.enterMode(13)
  assert.equal(sync.modeListeners(), 1)

  const async = fixture(t)
  const first = async.events.enterMode(13)
  const second = async.events.enterMode(13)
  async.bus.dispatch('annotationeditormodechanged', { mode: 13 })
  await Promise.all([first, second])
  assert.equal(async.modeListeners(), 1)
})

test('a competing mode interrupts pending insertion without retaining its listener', async (t) => {
  const { events, bus, modeListeners } = fixture(t)
  const pending = events.enterMode(13)
  bus.dispatch('annotationeditormodechanged', { mode: 0 })
  await assert.rejects(pending, /interrupted/)
  assert.equal(modeListeners(), 1)
})

test('disposal rejects pending and future requests and releases all subscriptions', async (t) => {
  const { events, lifetime, modeListeners } = fixture(t)
  const pending = events.enterMode(13)
  lifetime.abort()
  await assert.rejects(pending, /interrupted/)
  await assert.rejects(events.enterMode(13), /interrupted/)
  assert.equal(modeListeners(), 0)
})

test('timeouts and failed mode setters release their temporary subscriptions', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const delayed = fixture(t)
  const pending = delayed.events.enterMode(13)
  t.mock.timers.tick(10000)
  await assert.rejects(pending, /not ready/)
  assert.equal(delayed.modeListeners(), 1)

  const broken = fixture(t, () => {
    throw new Error('Mode failed')
  })
  await assert.rejects(broken.events.enterMode(13), /Mode failed/)
  assert.equal(broken.modeListeners(), 1)
})

test('commit uses the active editor or the selected editor when its menu has focus', (t) => {
  const { events, bus, lifetime } = fixture(t)
  const committed = []
  const active = { commitOrRemove: () => committed.push('active') }
  const selected = { commitOrRemove: () => committed.push('selected') }
  let current = active
  bus.dispatch('annotationeditoruimanager', {
    uiManager: { firstSelectedEditor: selected, hasSelection: true, getActive: () => current }
  })
  assert.equal(events.getSelectedEditor(), selected)
  assert.equal(events.hasSelection(), true)
  events.commit()
  current = null
  events.commit()
  assert.deepEqual(committed, ['active', 'selected'])
  lifetime.abort()
  events.commit()
  assert.equal(events.getSelectedEditor(), null)
  assert.equal(events.getActiveEditor(), null)
  assert.equal(events.hasSelection(), false)
  assert.equal(committed.length, 2)
})

test('subscriptions and mode changes stay isolated between document viewers', async (t) => {
  const first = fixture(t)
  const second = fixture(t)
  let changes = 0
  const unsubscribe = second.events.on('annotationeditorparamschanged', () => changes++)
  first.bus.dispatch('annotationeditorparamschanged', {})
  assert.equal(changes, 0)
  second.bus.dispatch('annotationeditorparamschanged', {})
  assert.equal(changes, 1)
  unsubscribe()
  second.bus.dispatch('annotationeditorparamschanged', {})
  assert.equal(changes, 1)
  first.lifetime.abort()
  const pending = second.events.enterMode(13)
  second.bus.dispatch('annotationeditormodechanged', { mode: 13 })
  await pending
})
