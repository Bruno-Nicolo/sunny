import type { PdfSource } from '../../../../shared/contracts'
import type { AnnotationOptions } from './annotations/types'
import type { TextEditorSettings } from './annotations/text/types'
import type { ChatAttachment, DocumentSource } from '../../../../shared/ai'
import type { IndexedPdf } from './chatDocument'

export type ViewerSnapshot = {
  page: number
  pages: number
  scale: string
  zoomPercent: number
  scrollTop: number
  rotation: number
  twoPageView: boolean
  canAnnotate: boolean
  signed: boolean
}

export type PdfViewPosition = Pick<
  ViewerSnapshot,
  'page' | 'scale' | 'scrollTop' | 'rotation' | 'twoPageView'
>

export type PdfSnapshot = { hash: string; data: Uint8Array }

export type PdfDocumentHandle = {
  prepareChatDocument(
    progress: (page: number, total: number) => void,
    signal: AbortSignal
  ): Promise<IndexedPdf>
  selectChatRegion(callback: ((attachment: ChatAttachment) => void) | null): void
  attachSelectedText(): ChatAttachment[]
  showCitation(source: DocumentSource): void
  readonly revision: string
  openSearch(): void
  snapshotDocument(previousHash?: string): Promise<PdfSnapshot | null>
  saveDocument(): Promise<Uint8Array>
  print(): Promise<void>
  setPage(page: number): void
  setScale(scale: string): void
  zoomIn(): void
  zoomOut(): void
  rotateClockwise(): void
  toggleTwoPageView(): void
  startPresentation(): Promise<void>
  navigateHorizontally(direction: -1 | 1): void
  scrollVertically(direction: -1 | 1): void
  setHighlightColor(color: string): void
  addImage(file: File): Promise<void>
  undo(): void
  redo(): void
}

export type PdfSearchSnapshot = {
  current: number
  total: number
  pending: boolean
}

export type PdfSearchOptions = {
  caseSensitive: boolean
  entireWord: boolean
}

export type PdfDocumentViewProps = AnnotationOptions & {
  sidebarOpen: boolean
  sidebarTab: 'pages' | 'outline'
  onSidebarTabChange(tab: 'pages' | 'outline'): void
  source: PdfSource
  initialPage: number
  initialScale: string
  initialScrollTop: number
  initialRotation: number
  initialTwoPageView: boolean
  onDirtyChange(dirty: boolean): void
  onSnapshot(snapshot: ViewerSnapshot): void
  onError(message: string): void
  onTextEditorChange(settings: TextEditorSettings | null): void
}

export type PasswordRequest = {
  incorrect: boolean
  submit(password: string): void
}
