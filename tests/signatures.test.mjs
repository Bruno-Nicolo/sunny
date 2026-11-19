import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSignatureStore } from './fixtures/signature-store.mjs'

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='

test('concurrent signature mutations preserve each entry and restrict file access', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sunny-signatures-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createSignatureStore(directory)
  const [first, second] = await Promise.all([store.create(image), store.create(image)])
  assert.deepEqual([first.name, second.name], ['signature 1', 'signature 2'])
  await Promise.all([store.rename(first.id, 'New name'), store.remove(second.id)])
  assert.deepEqual(await store.list(), [{ ...first, name: 'New name' }])
  assert.equal((await stat(join(directory, 'signatures.json'))).mode & 0o777, 0o600)
})

test('invalid library writes fail without replacing saved signatures or poisoning later writes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sunny-signatures-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createSignatureStore(directory)
  const item = await store.create(image)
  await assert.rejects(store.rename(item.id, ' '), /name/)
  await assert.rejects(store.rename(item.id, 'x'.repeat(101)), /name/)
  await assert.rejects(store.create('https://example.com/signature.png'), /PNG/)
  await assert.rejects(store.rename('missing', 'Name'), /no longer exists/)
  await store.rename(item.id, 'Updated')
  assert.equal((await store.list())[0].name, 'Updated')
  const before = await readFile(join(directory, 'signatures.json'), 'utf8')
  await writeFile(join(directory, 'signatures.json'), '{broken')
  await assert.rejects(store.list(), /could not be opened/)
  await assert.rejects(store.create(image), /could not be opened/)
  assert.equal(await readFile(join(directory, 'signatures.json'), 'utf8'), '{broken')
  await writeFile(
    join(directory, 'signatures.json'),
    JSON.stringify([{ ...item, dataUrl: 'https://example.com/signature.png' }])
  )
  await assert.rejects(store.list(), /could not be opened/)
  await writeFile(join(directory, 'signatures.json'), before)
  await store.remove(item.id)
  assert.deepEqual(await store.list(), [])
})
