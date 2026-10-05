import type { ShortcutCommand } from './shortcuts'

export type PdfFileStats = {
  mtimeMs: number
  size: number
}

export type OpenedPdf = PdfFileStats & {
  path: string
  name: string
  directoryName: string
  // Keep binary data opaque to React's development prop profiling.
  data: ArrayBuffer
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
}

export interface LepisApi {
  openPdfDialog(): Promise<OpenedPdf[]>
  getPathForFile(file: File): string
  readPdf(path: string): Promise<OpenedPdf>
  statPdf(path: string): Promise<PdfFileStats>
  savePdf(payload: SavePdfRequest): Promise<PdfFileStats>
  savePdfAs(payload: SavePdfAsRequest): Promise<OpenedPdf | null>
  closePdf(tabId: string): Promise<void>
  loadSession(): Promise<SessionState>
  saveSession(state: SessionState): Promise<void>
  setTheme(theme: SessionState['theme']): void
  confirmWindowClose(): void
  onOpenRequested(callback: (path: string) => void): () => void
  onCommand(command: ShortcutCommand | 'window-close-requested', callback: () => void): () => void
}
