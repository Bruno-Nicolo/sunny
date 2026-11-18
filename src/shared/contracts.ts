import type { ShortcutCommand } from './shortcuts'
import type { AiApi } from './ai'

export type PdfFileStats = {
  mtimeMs: number
  size: number
}

export type SuggestedPdf = PdfFileStats & {
  path: string
  name: string
}

export type PdfSource =
  { kind: 'file'; url: string; length: number } | { kind: 'memory'; data: ArrayBuffer }

export type OpenedPdf = PdfFileStats & {
  path: string
  name: string
  directoryPath: string
  source: PdfSource
}

export type SessionTab = {
  path: string
  page: number
  scale: string
  scrollTop: number
}

export type SessionState = {
  activePath: string | null
  tabs: SessionTab[]
  highlightColor: string
  highlightOpacity: number
  highlightThickness: number
  theme: 'system' | 'light' | 'dark'
}

export type SavePdfRequest = {
  tabId: string
  filePath: string
  data: Uint8Array
  expectedMtimeMs: number
}

export type SavePdfAsRequest = {
  data: Uint8Array
  suggestedName: string
  excludedPaths: string[]
}

export type SavePdfDraftRequest = PdfFileStats & {
  path: string
  data: Uint8Array
}

export type PdfDraft = Omit<OpenedPdf, 'source'> & {
  source: { kind: 'memory'; data: ArrayBuffer }
  savedAt: number
}

export interface LepisApi {
  ai: AiApi
  saveDraft(draft: SavePdfDraftRequest): Promise<void>
  loadDrafts(): Promise<PdfDraft[]>
  deleteDraft(path: string): Promise<void>
  openPdfDialog(): Promise<OpenedPdf[]>
  listDownloadPdfs(): Promise<SuggestedPdf[]>
  getPathForFile(file: File): string
  readPdf(path: string): Promise<OpenedPdf>
  releasePdfSource(source: PdfSource): Promise<void>
  statPdf(path: string): Promise<PdfFileStats>
  savePdf(payload: SavePdfRequest): Promise<PdfFileStats>
  savePdfAs(payload: SavePdfAsRequest): Promise<string | null>
  closePdf(tabId: string): Promise<void>
  showTabContextMenu(path: string): void
  loadSession(): Promise<SessionState>
  saveSession(state: SessionState): Promise<void>
  setTheme(theme: SessionState['theme']): void
  confirmWindowClose(): void
  onOpenRequested(callback: (path: string) => void): () => void
  onCommand(command: ShortcutCommand | 'window-close-requested', callback: () => void): () => void
}
