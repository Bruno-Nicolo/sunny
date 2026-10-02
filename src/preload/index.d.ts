import type { ShortcutCommand } from '../shared/shortcuts'
export type OpenedPdf = {
  path: string
  name: string
  directoryName: string
  data: Uint8Array
  mtimeMs: number
  size: number
}

export type SessionState = {
  activePath: string | null
  tabs: Array<{ path: string; page: number; scale: string; scrollTop: number }>
  highlightColor: string
  theme: 'system' | 'light' | 'dark'
}

export interface LepisApi {
  openPdfDialog(): Promise<OpenedPdf[]>
  getPathForFile(file: File): string
  getPathForFile(file: File): string
  readPdf(path: string): Promise<OpenedPdf>
  statPdf(path: string): Promise<{ mtimeMs: number; size: number }>
  savePdf(payload: {
    tabId: string
    filePath: string
    data: Uint8Array
    expectedMtimeMs: number
  }): Promise<{ mtimeMs: number; size: number }>
  savePdfAs(payload: { data: Uint8Array; suggestedName: string }): Promise<OpenedPdf | null>
  closePdf(tabId: string): Promise<void>
  loadSession(): Promise<SessionState>
  saveSession(state: SessionState): Promise<void>
  confirmWindowClose(): void
  onOpenRequested(callback: (path: string) => void): () => void
  onCommand(command: ShortcutCommand | 'window-close-requested', callback: () => void): () => void
}

declare global {
  interface Window {
    lepis: LepisApi
  }
}
