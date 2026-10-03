import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'

// Replace a file using a temporary file in the same directory; the directory must exist.
export async function writeFileAtomically(
  filePath: string,
  data: string | Uint8Array
): Promise<void> {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(tempPath, data)
    const handle = await fs.open(tempPath, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true })
    throw error
  }
}
