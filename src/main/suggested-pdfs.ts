import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SuggestedPdf } from '../shared/contracts'

/** Lists the latest PDFs in Downloads without opening document sources or scanning subfolders. */
export async function listDownloadPdfs(directory: string): Promise<SuggestedPdf[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
      .map(async (entry): Promise<SuggestedPdf | null> => {
        const path = join(directory, entry.name)
        try {
          const { mtimeMs, size } = await stat(path)
          return { path, name: entry.name, mtimeMs, size }
        } catch {
          // A download may be moved or removed while the directory is being listed.
          return null
        }
      })
  )
  return files
    .filter((file): file is SuggestedPdf => file !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
    .slice(0, 8)
}
