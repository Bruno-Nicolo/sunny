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
for (const name of [
  'pdf-sources',
  'atomic-write',
  'pdf-files',
  'session',
  'drafts',
  'suggested-pdfs',
  '../shared/highlight'
]) {
  const source = await readFile(new URL(`../src/main/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  })
  await writeFile(
    join(modulesPath, `${name.split('/').at(-1)}.mjs`),
    outputText
      .replace("from '../shared/highlight'", "from './highlight.mjs'")
      .replace("from './pdf-sources'", "from './pdf-sources.mjs'")
      .replace("from './atomic-write'", "from './atomic-write.mjs'")
      .replace("from './pdf-files'", "from './pdf-files.mjs'")
  )
}
const { readPdf, statPdf, savePdf, writePdfCopy, deleteBackup } = await import(
  pathToFileURL(join(modulesPath, 'pdf-files.mjs')).href
)
const { createPdfResponse, createPdfSource, releasePdfSource, releaseAllPdfSources } = await import(
  pathToFileURL(join(modulesPath, 'pdf-sources.mjs')).href
)
const { writeFileAtomically } = await import(
  pathToFileURL(join(modulesPath, 'atomic-write.mjs')).href
)
const { loadSession, saveSession } = await import(
  pathToFileURL(join(modulesPath, 'session.mjs')).href
)

const { createDraftStore } = await import(pathToFileURL(join(modulesPath, 'drafts.mjs')).href)
const { listDownloadPdfs } = await import(
  pathToFileURL(join(modulesPath, 'suggested-pdfs.mjs')).href
)

test('Downloads suggestions list only direct PDF files, newest first, capped at eight', async (t) => {
  const { directory } = await fixture(t)
  await rm(join(directory, 'document.pdf'))
  await mkdir(join(directory, 'folder.pdf'))
  await writeFile(join(directory, 'folder.pdf', 'nested.pdf'), original)
  await writeFile(join(directory, 'notes.txt'), 'not a PDF')
  for (let index = 0; index < 10; index++) {
    const name = `download-${index}.${index === 9 ? 'PDF' : 'pdf'}`
    const filePath = join(directory, name)
    await writeFile(filePath, original)
    await utimes(filePath, 1000 + index, 1000 + index)
  }
  const suggestions = await listDownloadPdfs(directory)
  assert.equal(suggestions.length, 8)
  assert.deepEqual(
    suggestions.map((file) => file.name),
    [
      'download-9.PDF',
      'download-8.pdf',
      'download-7.pdf',
      'download-6.pdf',
      'download-5.pdf',
      'download-4.pdf',
      'download-3.pdf',
      'download-2.pdf'
    ]
  )
  assert.deepEqual(suggestions[0], {
    path: join(directory, 'download-9.PDF'),
    name: 'download-9.PDF',
    size: original.length,
    mtimeMs: 1009000
  })
})

test('Downloads suggestions distinguish an empty directory from an unreadable path', async (t) => {
  const { directory } = await fixture(t)
  await rm(join(directory, 'document.pdf'))
  assert.deepEqual(await listDownloadPdfs(directory), [])
  await assert.rejects(listDownloadPdfs(join(directory, 'missing')), { code: 'ENOENT' })
})

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

test('opening a PDF returns a local source and metadata without an IPC byte buffer', async (t) => {
  const { filePath, directory } = await fixture(t)
  const opened = await readPdf(filePath)
  assert.equal(opened.source.kind, 'file')
  assert.equal('data' in opened, false)
  assert.equal(opened.path, filePath)
  assert.equal(opened.name, 'document.pdf')
  assert.equal(opened.directoryPath, directory)
  assert.deepEqual(
    new Uint8Array(await (await createPdfResponse(new Request(opened.source.url))).arrayBuffer()),
    new Uint8Array(original)
  )
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

test('saving a copy writes an independently openable PDF without changing the original', async (t) => {
  const { directory, filePath } = await fixture(t)
  const copyPath = join(directory, 'copy.pdf')
  await writePdfCopy(copyPath, new Uint8Array(edited))
  const copy = await readPdf(copyPath)
  assert.equal(copy.path, copyPath)
  assert.equal(copy.name, 'copy.pdf')
  assert.deepEqual(
    new Uint8Array(await (await createPdfResponse(new Request(copy.source.url))).arrayBuffer()),
    new Uint8Array(edited)
  )
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
  const defaultSession = {
    activePath: null,
    tabs: [],
    highlightColor: '#FDE047',
    highlightOpacity: 0.9,
    highlightThickness: 12,
    theme: 'system'
  }
  assert.deepEqual(await loadSession(sessionPath), defaultSession)
  const state = {
    activePath: filePath,
    tabs: [{ path: filePath, page: 3, scale: 'page-fit', scrollTop: 500 }],
    highlightColor: '#86EFAC',
    highlightOpacity: 0.45,
    highlightThickness: 24,
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

test('session restoration supplies valid tool preferences without losing open documents', async (t) => {
  const { userDataPath, filePath } = await fixture(t)
  await mkdir(userDataPath, { recursive: true })
  const sessionPath = join(userDataPath, 'session.json')
  const saved = {
    activePath: filePath,
    tabs: [{ path: filePath, page: 3, scale: 'page-fit', scrollTop: 500 }],
    theme: 'dark'
  }
  for (const preferences of [
    {},
    { highlightColor: null, highlightOpacity: '90', highlightThickness: -4 },
    { highlightColor: '#not-a-color', highlightOpacity: 2, highlightThickness: 100 }
  ]) {
    await writeFile(sessionPath, JSON.stringify({ ...saved, ...preferences }))
    assert.deepEqual(await loadSession(sessionPath), {
      ...saved,
      highlightColor: '#FDE047',
      highlightOpacity: 0.9,
      highlightThickness: 12
    })
  }
  await writeFile(sessionPath, JSON.stringify({ ...saved, highlightColor: '#86EFAC' }))
  assert.deepEqual(await loadSession(sessionPath), {
    ...saved,
    highlightColor: '#86EFAC',
    highlightOpacity: 0.9,
    highlightThickness: 12
  })
})

test('recovery drafts survive a new store, retain the original revision, and never change the PDF', async (t) => {
  const { filePath, userDataPath, payload } = await fixture(t)
  const store = createDraftStore(userDataPath)
  assert.deepEqual(await store.load(), [])
  const draft = {
    path: filePath,
    mtimeMs: payload.expectedMtimeMs,
    size: original.length,
    data: payload.data
  }
  await store.save(draft)
  const reopened = createDraftStore(userDataPath)
  const [recovered] = await reopened.load()
  assert.equal(recovered.path, filePath)
  assert.equal(recovered.mtimeMs, payload.expectedMtimeMs)
  assert.ok(recovered.savedAt > 0)
  assert.deepEqual(new Uint8Array(recovered.source.data), new Uint8Array(edited))
  assert.deepEqual(await readFile(filePath), original)
  await rm(filePath)
  assert.equal((await reopened.load()).length, 1, 'Missing originals do not prevent recovery')
  await reopened.remove(filePath)
  assert.deepEqual(await reopened.load(), [])
})

test('draft writes and deletion are serialized, invalid output preserves the previous draft', async (t) => {
  const { filePath, userDataPath, payload } = await fixture(t)
  const store = createDraftStore(userDataPath)
  const draft = { path: filePath, mtimeMs: 1, size: original.length, data: payload.data }
  await store.save(draft)
  await assert.rejects(store.save({ ...draft, data: new Uint8Array([1]) }), /Invalid recovery PDF/)
  assert.deepEqual(new Uint8Array((await store.load())[0].source.data), new Uint8Array(edited))
  await Promise.all([store.save(draft), store.remove(filePath)])
  assert.deepEqual(await store.load(), [])
  await store.save(draft)
  await writeFile(join(userDataPath, 'drafts', 'corrupt.draft'), '{broken')
  assert.equal((await store.load()).length, 1, 'One broken copy does not hide other documents')
})

test('draft storage keeps large PDFs in binary without Base64 expansion', async (t) => {
  const { filePath, userDataPath } = await fixture(t)
  const data = new Uint8Array(1024 * 1024)
  data.set(original)
  const store = createDraftStore(userDataPath)
  await store.save({ path: filePath, data, size: data.length, mtimeMs: 1 })
  const [name] = await readdir(join(userDataPath, 'drafts'))
  const stored = await readFile(join(userDataPath, 'drafts', name))
  assert.ok(stored.length < data.length + 1024)
  assert.deepEqual(new Uint8Array((await store.load())[0].source.data), data)
})

test('PDF ranges use a stable snapshot, survive original replacement and disappear on release', async (t) => {
  const { filePath } = await fixture(t)
  const pdf = await readPdf(filePath)
  const response = await createPdfResponse(
    new Request(pdf.source.url, { headers: { Range: 'bytes=0-7' } })
  )
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('Content-Range'), `bytes 0-7/${original.length}`)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), original.subarray(0, 8))
  await writeFile(filePath, edited)
  assert.deepEqual(
    Buffer.from(await (await createPdfResponse(new Request(pdf.source.url))).arrayBuffer()),
    original
  )
  const invalid = await createPdfResponse(
    new Request(pdf.source.url, { headers: { Range: 'bytes=999999-1000000' } })
  )
  assert.equal(invalid.status, 416)
  assert.equal(
    (await createPdfResponse(new Request('lepis-pdf://document/unregistered'))).status,
    404
  )
  await releasePdfSource(pdf.source)
  assert.equal((await createPdfResponse(new Request(pdf.source.url))).status, 404)
})

test('closing sources cancels in-flight snapshots and permits reopening afterward', async (t) => {
  const { filePath } = await fixture(t)
  const stats = await statPdf(filePath)
  const pending = createPdfSource(filePath, stats)
  const rejected = assert.rejects(pending, /source was closed/)
  await releaseAllPdfSources()
  await rejected
  const reopened = await readPdf(filePath)
  assert.equal((await createPdfResponse(new Request(reopened.source.url))).status, 200)
  await releasePdfSource(reopened.source)
})
