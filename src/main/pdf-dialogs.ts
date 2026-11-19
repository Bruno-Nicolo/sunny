import { dialog, type BrowserWindow } from 'electron'
import { resolve } from 'path'
import { realpath } from 'fs/promises'
import type { OpenedPdf, PdfCopyDestination } from '../shared/contracts'
import { readPdf } from './pdf-files'

export async function openPdfDialog(window: BrowserWindow | null): Promise<OpenedPdf[]> {
  if (!window) return []
  const result = await dialog.showOpenDialog(window, {
    title: 'Open PDF',
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled) return []
  return Promise.all(result.filePaths.map(readPdf))
}

export async function choosePdfCopyPath(
  window: BrowserWindow | null,
  { suggestedName, excludedPaths }: PdfCopyDestination
): Promise<string | null> {
  if (!window) return null
  const result = await dialog.showSaveDialog(window, {
    title: 'Save PDF as',
    defaultPath: suggestedName,
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return null
  const filePath = result.filePath.toLowerCase().endsWith('.pdf')
    ? result.filePath
    : `${result.filePath}.pdf`
  const canonical = async (path: string): Promise<string> =>
    (await realpath(path).catch(() => resolve(path))).toLowerCase()
  const destination = await canonical(filePath)
  if ((await Promise.all(excludedPaths.map(canonical))).includes(destination))
    throw new Error(
      'Choose a different file name. An open PDF cannot be overwritten by an export or copy.'
    )
  return filePath
}
