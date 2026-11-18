import type { CSSProperties } from 'react'
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent
} from '@/components/ui/sidebar'
import { AnnotationToolOptions } from '@/features/pdf/annotations/AnnotationToolOptions'
import type { AnnotationTool } from '@/features/pdf/annotations/types'
import type { TextEditorSettings } from '@/features/pdf/annotations/text/types'

type Props = {
  canAnnotate: boolean
  annotationTool: AnnotationTool
  highlightColor: string
  textSettings: TextEditorSettings | null
  onHighlightColorChange(color: string): void
}

export function ToolOptionsSidebar({
  canAnnotate,
  annotationTool,
  highlightColor,
  textSettings,
  onHighlightColorChange
}: Props): React.JSX.Element | null {
  if (
    !canAnnotate ||
    (annotationTool !== 'highlight' && (annotationTool !== 'text' || !textSettings))
  )
    return null

  const title = annotationTool === 'text' ? 'Text' : 'Highlight'
  const label = `${title} tool settings`
  const options = (
    <AnnotationToolOptions
      key={annotationTool}
      annotationTool={annotationTool}
      highlightColor={highlightColor}
      textSettings={textSettings}
      onHighlightColorChange={onHighlightColorChange}
    />
  )

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
        aria-label={label}
      >
        <SidebarHeader className="p-4 pb-3">
          <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        </SidebarHeader>
        <SidebarContent className="px-4 pb-4">
          <SidebarGroup className="p-0">
            <SidebarGroupContent>{options}</SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  )
}
