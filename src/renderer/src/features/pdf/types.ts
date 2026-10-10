export type ViewerSnapshot = {
  page: number
  pages: number
  scale: string
  zoomPercent: number
  scrollTop: number
  canAnnotate: boolean
  signed: boolean
}

export type PdfViewPosition = Pick<ViewerSnapshot, 'page' | 'scale' | 'scrollTop'>

export type PdfDocumentHandle = {
  saveDocument(): Promise<Uint8Array>
  setPage(page: number): void
  setScale(scale: string): void
  zoomIn(): void
  zoomOut(): void
  navigateHorizontally(direction: -1 | 1): void
  addImage(file: File): Promise<void>
  undo(): void
  redo(): void
}

export type AnnotationTool = 'none' | 'highlight' | 'text'

export type PdfAnnotationOptions = {
  active: boolean
  annotationTool: AnnotationTool
  highlightColor: string
}

export type PdfDocumentViewProps = PdfAnnotationOptions & {
  sidebarOpen: boolean
  data: ArrayBuffer
  initialPage: number
  initialScale: string
  initialScrollTop: number
  onDirtyChange(dirty: boolean): void
  onSnapshot(snapshot: ViewerSnapshot): void
  onError(message: string): void
}

export type PasswordRequest = {
  incorrect: boolean
  submit(password: string): void
}

export type TextEditorSettings = {
  element: HTMLDivElement
  color: string
  size: number
  setColor(color: string): void
  setSize(size: number): void
}
