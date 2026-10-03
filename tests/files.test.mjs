import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import ts from 'typescript'

// Load the filesystem modules without starting Electron, using the project's TypeScript compiler.
const modulesPath = await mkdtemp(join(tmpdir(), 'lepis-test-modules-'))
after(() => rm(modulesPath, { recursive: true, force: true }))
for (const name of ['atomic-write', 'pdf-files', 'session']) {
  const source = await readFile(new URL(`../src/main/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  })
  await writeFile(
    join(modulesPath, `${name}.mjs`),
    outputText.replace("from './atomic-write'", "from './atomic-write.mjs'")
  )
}
const { readPdf, statPdf, savePdf, writePdfCopy, deleteBackup } = await import(
  pathToFileURL(join(modulesPath, 'pdf-files.mjs')).href
)
const { writeFileAtomically } = await import(
  pathToFileURL(join(modulesPath, 'atomic-write.mjs')).href
)
const { loadSession, saveSession } = await import(
  pathToFileURL(join(modulesPath, 'session.mjs')).href
)

const original = Buffer.from('%PDF-1.7\noriginal\n%%EOF\n')
const edited = Buffer.from('%PDF-1.7\nedited annotation\n%%EOF\n')

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lepis-files-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'document.pdf')
  const userDataPath = join(directory, 'user-data')
  await writeFile(filePath, original)
  const tabId = 'document-tab'
  const backupPath = join(
    userDataPath,
    'backups',
    `${createHash('sha256').update(tabId).digest('hex')}.pdf`
  )
  const { mtimeMs } = await statPdf(filePath)
  return {
    directory,
    filePath,
    userDataPath,
    backupPath,
    payload: { tabId, filePath, data: new Uint8Array(edited), expectedMtimeMs: mtimeMs }
  }
}

test('reading a PDF returns bytes and filesystem metadata and rejects invalid files', async (t) => {
  const { filePath, directory } = await fixture(t)
  const opened = await readPdf(filePath)
  assert.ok(opened.data instanceof ArrayBuffer)
  assert.equal(opened.path, filePath)
  assert.equal(opened.name, 'document.pdf')
  assert.equal(opened.directoryName, directory.split('/').at(-1))
  assert.deepEqual(new Uint8Array(opened.data), new Uint8Array(original))
  assert.deepEqual({ size: opened.size, mtimeMs: opened.mtimeMs }, await statPdf(filePath))
  await writeFile(filePath, 'invalid')
  await assert.rejects(readPdf(filePath), /not a valid PDF/)
})

test('saving preserves the previous PDF as a backup and closing removes it', async (t) => {
  const { filePath, directory, userDataPath, backupPath, payload } = await fixture(t)
  const saved = await savePdf(payload, userDataPath)
  assert.deepEqual(await readFile(filePath), edited)
  assert.deepEqual(await readFile(backupPath), original)
  assert.deepEqual(saved, await statPdf(filePath))
  assert.equal(
    (await readdir(directory)).some((name) => name.endsWith('.tmp')),
    false
  )
  await deleteBackup(userDataPath, payload.tabId)
  await assert.rejects(readFile(backupPath), { code: 'ENOENT' })
  await deleteBackup(userDataPath, payload.tabId)
})

test('an external change prevents saving without replacing the file or its backup', async (t) => {
  const { filePath, userDataPath, backupPath, payload } = await fixture(t)
  await savePdf(payload, userDataPath)
  const external = Buffer.from('%PDF-1.7\nexternal change\n%%EOF\n')
  await writeFile(filePath, external)
  const changedTime = new Date(payload.expectedMtimeMs + 10000)
  await utimes(filePath, changedTime, changedTime)
  await assert.rejects(savePdf(payload, userDataPath), /FILE_CHANGED_EXTERNALLY/)
  assert.deepEqual(await readFile(filePath), external)
  assert.deepEqual(await readFile(backupPath), original)
})

test('invalid PDF output leaves the original intact and creates no backup or copy', async (t) => {
  const { directory, filePath, userDataPath, backupPath, payload } = await fixture(t)
  const invalid = new Uint8Array(Buffer.from('invalid'))
  await assert.rejects(
    savePdf({ ...payload, data: invalid }, userDataPath),
    /invalid document data/
  )
  assert.deepEqual(await readFile(filePath), original)
  await assert.rejects(readFile(backupPath), { code: 'ENOENT' })
  const copyPath = join(directory, 'copy.pdf')
  await assert.rejects(writePdfCopy(copyPath, invalid), /invalid document data/)
  await assert.rejects(readFile(copyPath), { code: 'ENOENT' })
})

test('saving a copy returns the new document without changing the original', async (t) => {
  const { directory, filePath } = await fixture(t)
  const copyPath = join(directory, 'copy.pdf')
  const copy = await writePdfCopy(copyPath, new Uint8Array(edited))
  assert.equal(copy.path, copyPath)
  assert.equal(copy.name, 'copy.pdf')
  assert.deepEqual(new Uint8Array(copy.data), new Uint8Array(edited))
  assert.deepEqual(await readFile(filePath), original)
  await writePdfCopy(copyPath, new Uint8Array(original))
  assert.deepEqual(await readFile(copyPath), original)
})

test('failed replacement cleans up the temporary file and preserves the destination', async (t) => {
  const { directory } = await fixture(t)
  const destination = join(directory, 'occupied')
  await mkdir(destination)
  await writeFile(join(destination, 'keep.txt'), 'keep')
  const before = await readdir(directory)
  await assert.rejects(writeFileAtomically(destination, edited))
  assert.deepEqual(await readdir(directory), before)
  assert.equal(await readFile(join(destination, 'keep.txt'), 'utf8'), 'keep')
})

test('session persistence creates its directory, restores state, and handles missing or corrupt files', async (t) => {
  const { userDataPath, filePath } = await fixture(t)
  const sessionPath = join(userDataPath, 'session.json')
  const defaultSession = { activePath: null, tabs: [], highlightColor: '#fde047', theme: 'system' }
  assert.deepEqual(await loadSession(sessionPath), defaultSession)
  const state = {
    activePath: filePath,
    tabs: [{ path: filePath, page: 3, scale: 'page-fit', scrollTop: 500 }],
    highlightColor: '#86EFAC',
    theme: 'dark'
  }
  await saveSession(sessionPath, state)
  assert.deepEqual(await loadSession(sessionPath), state)
  await saveSession(sessionPath, { ...state, theme: 'light' })
  assert.deepEqual(await loadSession(sessionPath), { ...state, theme: 'light' })
  assert.deepEqual(await readdir(userDataPath), ['session.json'])
  await writeFile(sessionPath, '{broken')
  assert.deepEqual(await loadSession(sessionPath), defaultSession)
})
