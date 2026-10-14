import type { SavePdfDraftRequest } from '../../../../shared/contracts'
import type { PdfDocumentHandle } from '../pdf/types'
import type { Tab } from './types'

type Options = {
  getTabs(): Tab[]
  getViewer(id: string): PdfDocumentHandle | undefined
  save(draft: SavePdfDraftRequest): Promise<void>
  onError(message: string): void
}

// Pause and drain snapshots before saving, replacing, or closing a document.
export type DraftAutosave = {
  tick(options: Options): Promise<void>
  withPaused<T>(ids: string[], action: () => Promise<T>): Promise<T>
}

export function createDraftAutosave(): DraftAutosave {
  const paused = new Map<string, number>()
  const pending = new Map<string, Promise<void>>()
  const hashes = new Map<string, string>()
  let running = false
  const failures = new Set<string>()
  return {
    async tick({ getTabs, getViewer, save, onError }: Options): Promise<void> {
      if (running) return
      running = true
      try {
        for (const tab of getTabs()) {
          const viewer = getViewer(tab.id)
          if (!tab.dirty || !tab.view.pages || tab.error || paused.has(tab.id) || !viewer) continue
          const task = (async () => {
            const snapshot = await viewer.snapshotDocument(hashes.get(tab.id))
            if (!snapshot) return
            if (
              paused.has(tab.id) ||
              !getTabs().some(
                (current) => current.id === tab.id && current.data === tab.data && current.dirty
              )
            )
              return
            await save({
              path: tab.path,
              mtimeMs: tab.mtimeMs,
              size: tab.size,
              data: snapshot.data
            })
            hashes.set(tab.id, snapshot.hash)
            failures.delete(tab.id)
          })()
          pending.set(tab.id, task)
          try {
            await task
          } catch {
            if (!failures.has(tab.id))
              onError('Recovery copies could not be saved. Save your changes with ⌘S.')
            failures.add(tab.id)
          } finally {
            pending.delete(tab.id)
          }
        }
      } finally {
        running = false
      }
    },
    async withPaused(ids, action) {
      for (const id of ids) paused.set(id, (paused.get(id) ?? 0) + 1)
      try {
        await Promise.all(ids.map((id) => pending.get(id)?.catch(() => {})))
        return await action()
      } finally {
        for (const id of ids) {
          const count = paused.get(id)! - 1
          if (count) paused.set(id, count)
          else paused.delete(id)
          hashes.delete(id)
          failures.delete(id)
        }
      }
    }
  }
}
