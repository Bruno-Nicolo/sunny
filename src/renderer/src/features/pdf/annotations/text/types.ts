export type TextFontFamily = 'serif' | 'sans-serif' | 'monospace'
export type TextAlignment = 'left' | 'center' | 'right'

export type TextStyle = {
  color: string
  fontSize: number
  fontFamily: TextFontFamily
  textAlign: TextAlignment
}

export type TextEditorSettings = TextStyle & {
  element: HTMLDivElement | null
  setStyle(style: Partial<TextStyle>, live?: boolean): void
  commitStyle(): void
}
