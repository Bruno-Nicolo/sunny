import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'
import type { OpenedPdf, PdfFileStats, SavePdfRequest } from '../shared/contracts'
import { createPdfSource } from './pdf-sources'
import { writeFileAtomically } from './atomic-write'

function backupPath(userDataPath: string, tabId: string): string {
  const id = createHash('sha256').update(tabId).digest('hex')
  return join(userDataPath, 'backups', `${id}.pdf`)
}

export function hasPdfHeader(data: Uint8Array): boolean {
  return Buffer.from(data.subarray(0, 1024)).toString('latin1').includes('%PDF-')
}

function validatePdfOutput(data: Uint8Array): void {
  if (!hasPdfHeader(data)) throw new Error('PDF.js produced invalid document data.')
}

export async function readPdf(filePath: string): Promise<OpenedPdf> {
  const file = await fs.open(filePath, 'r')
  try {
    const [{ mtimeMs, size }, { buffer, bytesRead }] = await Promise.all([
      file.stat(),
      file.read({ buffer: Buffer.alloc(1024), length: 1024, position: 0 })
    ])
    if (!hasPdfHeader(buffer.subarray(0, bytesRead)))
      throw new Error('The selected file is not a valid PDF.')
    const stats = { mtimeMs, size }
    return {
      path: filePath,
      name: basename(filePath),
      directoryName: basename(dirname(filePath)),
      source: await createPdfSource(filePath, stats),
      ...stats
    }
  } finally {
    await file.close()
  }
}

export async function statPdf(filePath: string): Promise<PdfFileStats> {
  const { mtimeMs, size } = await fs.stat(filePath)
  return { mtimeMs, size }
}

export async function savePdf(
  { tabId, filePath, data, expectedMtimeMs }: SavePdfRequest,
  userDataPath: string
): Promise<PdfFileStats> {
  const current = await statPdf(filePath)
  if (Math.abs(current.mtimeMs - expectedMtimeMs) > 1) {
    throw new Error('FILE_CHANGED_EXTERNALLY')
  }
  validatePdfOutput(data)
  const copyPath = backupPath(userDataPath, tabId)
  await fs.mkdir(dirname(copyPath), { recursive: true })
  await fs.copyFile(filePath, copyPath)
  await writeFileAtomically(filePath, data)
  return statPdf(filePath)
}

export async function writePdfCopy(filePath: string, data: Uint8Array): Promise<OpenedPdf> {
  validatePdfOutput(data)
  await writeFileAtomically(filePath, data)
  return readPdf(filePath)
}

export async function deleteBackup(userDataPath: string, tabId: string): Promise<void> {
  await fs.rm(backupPath(userDataPath, tabId), { force: true })
}
