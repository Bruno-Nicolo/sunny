export type AnnotationTool = 'none' | 'highlight' | 'text'

export type AnnotationOptions = {
  active: boolean
  annotationTool: AnnotationTool
  highlightColor: string
}
