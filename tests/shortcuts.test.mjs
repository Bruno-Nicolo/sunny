import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/shared/shortcuts.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
})
const { shortcuts, matchesKeyBinding } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function matches(id, key, modifiers = {}, isMac = true) {
  const event = {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers
  }
  return shortcuts
    .find((shortcut) => shortcut.id === id)
    .keys.some((binding) => matchesKeyBinding(event, binding, isMac))
}

test('Ctrl+Tab cycles tabs and Shift reverses the direction on each platform', () => {
  for (const isMac of [true, false]) {
    assert.equal(matches('next-tab', 'Tab', { ctrlKey: true }, isMac), true)
    assert.equal(matches('previous-tab', 'Tab', { ctrlKey: true, shiftKey: true }, isMac), true)
    assert.equal(matches('next-tab', 'Tab', { ctrlKey: true, shiftKey: true }, isMac), false)
    assert.equal(matches('previous-tab', 'Tab', { ctrlKey: true }, isMac), false)
    assert.equal(matches('next-tab', 'Tab', { metaKey: true }, isMac), false)
    assert.equal(matches('next-tab', 'Tab', {}, isMac), false)
  }
})

test('zoom accepts plus and equals with the platform command key', () => {
  for (const isMac of [true, false]) {
    const modifier = isMac ? { metaKey: true } : { ctrlKey: true }
    assert.equal(matches('zoom-in', '+', modifier, isMac), true)
    assert.equal(matches('zoom-in', '+', { ...modifier, shiftKey: true }, isMac), false)
    assert.equal(matches('zoom-in', '=', modifier, isMac), true)
    assert.equal(matches('zoom-in', '+', {}, isMac), false)
  }
})

test('horizontal navigation accepts only unmodified left and right arrows', () => {
  for (const [id, key] of [
    ['navigate-left', 'ArrowLeft'],
    ['navigate-right', 'ArrowRight']
  ]) {
    assert.equal(matches(id, key), true)
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      assert.equal(matches(id, key, { [modifier]: true }), false)
    }
  }
})

test('additional modifiers do not trigger a shortcut', () => {
  assert.equal(matches('next-tab', 'Tab', { ctrlKey: true, altKey: true }), false)
  assert.equal(matches('next-tab', 'Tab', { ctrlKey: true, metaKey: true }), false)
  assert.equal(matches('zoom-in', '+', { ctrlKey: true, metaKey: true }), false)
})

test('native accelerators cover zoom, closing, and all nine tab positions', () => {
  const accelerator = (id) => shortcuts.find((shortcut) => shortcut.id === id).accelerator
  assert.equal(accelerator('zoom-in'), 'CmdOrCtrl+Plus')
  assert.equal(accelerator('zoom-out'), 'CmdOrCtrl+-')
  assert.equal(accelerator('close-tab'), 'CmdOrCtrl+W')
  assert.equal(accelerator('next-tab'), 'Ctrl+Tab')
  assert.equal(accelerator('previous-tab'), 'Ctrl+Shift+Tab')
  for (let position = 1; position <= 9; position++) {
    assert.equal(accelerator(`tab-${position}`), `CmdOrCtrl+${position}`)
  }
  assert.equal(new Set(shortcuts.map(({ id }) => id)).size, shortcuts.length)
})
