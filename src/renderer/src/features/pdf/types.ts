import type { PdfSource } from '../../../../shared/contracts'
import type {
  AnnotationInsertionPoint,
  AnnotationOptions,
  HighlightStyle
} from './annotations/types'
import type { TextEditorSettings } from './annotations/text/types'
import type { ChatAttachment, ChatDocument, DocumentSource } from '../../../../shared/ai'

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
    file: Pick<ChatDocument, 'path' | 'name'>,
    progress: (page: number, total: number) => void,
    signal: AbortSignal
  ): Promise<ChatDocument>
  selectChatRegion(callback: ((attachment: ChatAttachment) => void) | null): void
  attachSelectedText(): ChatAttachment[]
  highlightSelectedText(): void
  showCitation(source: DocumentSource): void
  readonly revision: string
  preparePageChanges(): Promise<{ data: Uint8Array; page: number } | null>
  confirmPageChanges(): Promise<boolean>
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
  setHighlightStyle(style: Partial<HighlightStyle>, live?: boolean): void
  addImage(file: File, point?: AnnotationInsertionPoint): Promise<void>
  placeImage(src: string): Promise<void>
  cancelImagePlacement(): void
  addText(text: string, point?: AnnotationInsertionPoint): Promise<void>
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
  canAnnotate: boolean
  navigationOpen: boolean
  onNavigationOpenChange(open: boolean): void
  navigationTab: 'pages' | 'outline'
  onNavigationTabChange(tab: 'pages' | 'outline'): void
  onSavePages(data: Uint8Array, page: number, onSaved: () => void): Promise<boolean>
  onExportPages(data: Uint8Array): Promise<boolean>
  onPageDraftChange(dirty: boolean): void
  source: PdfSource
  initialPage: number
  initialScale: string
  initialScrollTop: number
  initialRotation: number
  initialTwoPageView: boolean
  onAskAI(attachments: ChatAttachment[]): void
  onDirtyChange(dirty: boolean): void
  onSnapshot(snapshot: ViewerSnapshot): void
  onError(message: string): void
  onTextEditorChange(settings: TextEditorSettings | null): void
}

export type PasswordRequest = {
  incorrect: boolean
  submit(password: string): void
}
