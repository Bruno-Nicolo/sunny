import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { open, mkdtemp, rm, stat, chmod } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { PdfFileStats, PdfSource } from '../shared/contracts'

const cloneFile = promisify(execFile)

const sources = new Map<
  string,
  { path: string; originalPath: string; originalStats: PdfFileStats }
>()
const byPath = new Map<string, string>()
const opening = new Map<string, Promise<PdfSource>>()
let directory: string | undefined
let folder: Promise<string> | undefined
let generation = 0
process.once('exit', () => {
  if (directory) rmSync(directory, { recursive: true, force: true })
})

export async function createPdfSource(path: string, stats: PdfFileStats): Promise<PdfSource> {
  const pending = opening.get(path)
  if (pending) {
    await pending.catch(() => {})
    return createPdfSource(path, stats)
  }
  const previous = byPath.get(path)
  if (previous) {
    const source = sources.get(previous)!
    if (source.originalStats.size === stats.size && source.originalStats.mtimeMs === stats.mtimeMs)
      return { kind: 'file', url: previous, length: stats.size }
  }
  const create = async (): Promise<PdfSource> => {
    const currentGeneration = generation
    const id = randomUUID()
    const url = `lepis-pdf://document/${id}`
    const snapshot = join(
      await (folder ??= mkdtemp(join(tmpdir(), 'lepis-pdf-sources-')).then(
        (path) => (directory = path)
      )),
      id + '.pdf'
    )
    try {
      // macOS cp uses APFS cloning; Node's copyFile materializes even sparse files here.
      await cloneFile('/bin/cp', ['-c', '--', resolve(path), snapshot])
      const current = await stat(path)
      if (Math.abs(current.mtimeMs - stats.mtimeMs) > 1 || current.size !== stats.size)
        throw new Error('FILE_CHANGED_EXTERNALLY')
      await chmod(snapshot, 0o400)
      if (currentGeneration !== generation) throw new Error('The PDF source was closed.')
      sources.set(url, {
        path: snapshot,
        originalPath: path,
        originalStats: stats
      })
      byPath.set(path, url)
      return { kind: 'file', url, length: stats.size }
    } catch (error) {
      await rm(snapshot, { force: true })
      throw error
    }
  }
  const result = create()
  opening.set(path, result)
  try {
    return await result
  } finally {
    if (opening.get(path) === result) opening.delete(path)
  }
}

export async function releasePdfSource(source: PdfSource): Promise<void> {
  if (source.kind !== 'file') return
  const entry = sources.get(source.url)
  if (!entry) return
  sources.delete(source.url)
  if (byPath.get(entry.originalPath) === source.url) byPath.delete(entry.originalPath)
  await rm(entry.path, { force: true })
}

export async function releaseAllPdfSources(): Promise<void> {
  generation++
  await Promise.all(
    [...sources.keys()].map((url) =>
      releasePdfSource({ kind: 'file', url, length: sources.get(url)!.originalStats.size })
    )
  )
}

// Serve only registered PDFs; open descriptors belong to the cancellable response stream.
export async function createPdfResponse(request: Request): Promise<Response> {
  const headers = new Headers({
    'Content-Type': 'application/pdf',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range'
  })
  const source = sources.get(request.url)
  if (!source) return new Response(null, { status: 404, headers })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers })
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(source.path, 'r')
    const stats = source.originalStats
    const range = request.headers.get('Range')
    const match = range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = match ? Number(match[1]) : 0
    const end = match?.[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1
    if (
      (range && !match) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end ||
      start >= stats.size
    ) {
      await file.close()
      headers.set('Content-Range', `bytes */${stats.size}`)
      return new Response(null, { status: 416, headers })
    }
    headers.set('Content-Length', String(end - start + 1))
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stats.size}`)
    if (request.method === 'HEAD') {
      await file.close()
      return new Response(null, { status: range ? 206 : 200, headers })
    }
    const body = Readable.toWeb(file.createReadStream({ start, end, autoClose: true }))
    return new Response(body as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers })
  } catch (error) {
    await file?.close().catch(() => {})
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return new Response(null, { status: 404, headers })
    throw error
  }
}
