import { serialize, deserialize } from 'v8'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'
import type { PdfDraft, SavePdfDraftRequest } from '../shared/contracts'
import { hasPdfHeader } from './pdf-files'
import { writeFileAtomically } from './atomic-write'

// Store metadata and PDF bytes together so an interrupted write cannot mix revisions.
type DraftStore = {
  save(draft: SavePdfDraftRequest): Promise<void>
  remove(path: string): Promise<void>
  load(): Promise<PdfDraft[]>
}

export function createDraftStore(userDataPath: string): DraftStore {
  const directory = join(userDataPath, 'drafts')
  let pending: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.catch(() => {}).then(operation)
    pending = result
    return result
  }
  const draftPath = (path: string): string =>
    join(directory, `${createHash('sha256').update(path).digest('hex')}.draft`)

  return {
    save: (draft: SavePdfDraftRequest): Promise<void> =>
      enqueue(async () => {
        if (!hasPdfHeader(draft.data)) throw new Error('Invalid recovery PDF.')
        await fs.mkdir(directory, { recursive: true })
        await writeFileAtomically(
          draftPath(draft.path),
          serialize({
            path: draft.path,
            mtimeMs: draft.mtimeMs,
            size: draft.size,
            savedAt: Date.now(),
            data: draft.data
          })
        )
      }),
    remove: (path: string): Promise<void> => enqueue(() => fs.rm(draftPath(path), { force: true })),
    load: (): Promise<PdfDraft[]> =>
      enqueue(async () => {
        let names: string[]
        try {
          names = await fs.readdir(directory)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
          throw error
        }
        const drafts: PdfDraft[] = []
        for (const name of names.filter((name) => name.endsWith('.draft'))) {
          try {
            const stored = deserialize(await fs.readFile(join(directory, name)))
            if (
              typeof stored.path !== 'string' ||
              !(stored.data instanceof Uint8Array) ||
              !Number.isFinite(stored.mtimeMs) ||
              !Number.isFinite(stored.size) ||
              !Number.isFinite(stored.savedAt)
            )
              throw new Error('Invalid recovery metadata.')
            const data: Uint8Array = stored.data
            if (!hasPdfHeader(data)) throw new Error('Invalid recovery PDF.')
            drafts.push({
              path: stored.path,
              name: basename(stored.path),
              directoryName: basename(dirname(stored.path)),
              mtimeMs: stored.mtimeMs,
              size: stored.size,
              savedAt: stored.savedAt,
              data: new Uint8Array(data).buffer
            })
          } catch {
            // Leave unreadable drafts on disk; other documents can still be recovered.
          }
        }
        return drafts
      })
  }
}
