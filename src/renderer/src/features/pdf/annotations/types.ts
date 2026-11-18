import type { HighlightStyle } from '../../../../../shared/highlight'

export type { HighlightStyle } from '../../../../../shared/highlight'

export type AnnotationTool = 'none' | 'highlight' | 'text'

export type AnnotationInsertionPoint = { clientX: number; clientY: number }

export type AnnotationOptions = {
  active: boolean
  annotationTool: AnnotationTool
  highlightStyle: HighlightStyle
}
