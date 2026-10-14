export type TextEditorSettings = {
  element: HTMLDivElement | null
  color: string
  size: number
  setColor(color: string): void
  setSize(size: number): void
}
