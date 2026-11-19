import type { CSSProperties } from 'react'
import { Sidebar, SidebarProvider, SidebarContent } from '@/components/ui/sidebar'
import { AnnotationToolOptions } from '@/features/pdf/annotations/AnnotationToolOptions'
import type { AnnotationTool, HighlightStyle } from '@/features/pdf/annotations/types'
import type { TextEditorSettings } from '@/features/pdf/annotations/text/types'

type Props = {
  signatureOptions: React.ReactNode
  canAnnotate: boolean
  annotationTool: AnnotationTool
  highlightStyle: HighlightStyle
  highlightFreehandOnly: boolean
  onHighlightFreehandOnlyChange(checked: boolean): void
  textSettings: TextEditorSettings | null
  onHighlightStyleChange(style: Partial<HighlightStyle>, live?: boolean): void
}

export function ToolOptionsSidebar({
  canAnnotate,
  signatureOptions,
  annotationTool,
  highlightStyle,
  highlightFreehandOnly,
  onHighlightFreehandOnlyChange,
  textSettings,
  onHighlightStyleChange
}: Props): React.JSX.Element | null {
  if (
    !canAnnotate ||
    (!signatureOptions &&
      annotationTool !== 'highlight' &&
      (annotationTool !== 'text' || !textSettings))
  )
    return null

  const title = signatureOptions ? 'Signature' : annotationTool === 'text' ? 'Text' : 'Highlight'
  const label = `${title} tool settings`

  return (
    <SidebarProvider
      className="min-h-0 w-auto shrink-0"
      style={{ '--sidebar-width': '260px' } as CSSProperties}
    >
      <Sidebar
        collapsible="none"
        className="tool-options-sidebar min-h-0 w-[var(--sidebar-width)] shrink-0 border-r border-sidebar-border"
        role="complementary"
        data-sidebar="sidebar"
        data-text-settings={annotationTool === 'text' ? '' : undefined}
        data-signature-options={signatureOptions ? '' : undefined}
        aria-label={label}
      >
        <SidebarContent className="p-4">
          {signatureOptions ?? (
            <AnnotationToolOptions
              key={annotationTool}
              annotationTool={annotationTool}
              highlightStyle={highlightStyle}
              highlightFreehandOnly={highlightFreehandOnly}
              onHighlightFreehandOnlyChange={onHighlightFreehandOnlyChange}
              textSettings={textSettings}
              onHighlightStyleChange={onHighlightStyleChange}
            />
          )}
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  )
}
