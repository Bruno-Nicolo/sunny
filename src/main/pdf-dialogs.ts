import { dialog, type BrowserWindow } from 'electron'
import type { OpenedPdf, SavePdfAsRequest } from '../shared/contracts'
import { readPdf, writePdfCopy } from './pdf-files'

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

export async function savePdfAs(
  window: BrowserWindow | null,
  { data, suggestedName }: SavePdfAsRequest
): Promise<OpenedPdf | null> {
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
  return writePdfCopy(filePath, data)
}
