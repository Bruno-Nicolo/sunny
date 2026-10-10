import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnnotationTool } from '@/features/pdf/annotations/types'
import { useAppShortcuts } from '@/features/shortcuts/useAppShortcuts'
import type { ShortcutHandlers } from '../../shared/shortcuts'
import type { SessionState } from '../../shared/contracts'
import type { PdfDocumentHandle } from '@/features/pdf/types'
import type { DocumentsState } from '@/features/documents/documentsReducer'
import { useDocuments } from '@/features/documents/useDocuments'
import { persistDocumentSession, useDocumentSession } from '@/features/session/useDocumentSession'
import { TabBar } from '@/features/documents/components/TabBar'
import { DocumentToolbar } from '@/features/documents/components/DocumentToolbar'
import { DocumentWorkspace } from '@/features/documents/components/DocumentWorkspace'
import { CloseDocumentsDialog } from '@/features/documents/components/CloseDocumentsDialog'
import { FileConflictDialog } from '@/features/documents/components/FileConflictDialog'
import { useImageInsertion } from '@/features/pdf/annotations/images/useImageInsertion'
import { defaultHighlightColor } from '@/features/pdf/annotations/highlight/colors'

function App(): React.JSX.Element {
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('none')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [highlightColor, setHighlightColor] = useState<string>(defaultHighlightColor)
  const [theme, setTheme] = useState<SessionState['theme']>('system')
  const [message, setMessage] = useState<string | null>(null)
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showMessage = useCallback((text: string): void => {
    if (messageTimer.current) clearTimeout(messageTimer.current)
    setMessage(text)
    messageTimer.current = setTimeout(() => setMessage(null), 3200)
  }, [])
  useEffect(
    () => () => {
      if (messageTimer.current) clearTimeout(messageTimer.current)
    },
    []
  )

  const persistSession = useCallback(
    (state: DocumentsState): Promise<void> =>
      persistDocumentSession(state, { highlightColor, theme }),
    [highlightColor, theme]
  )

  const {
    tabs,
    activeId,
    activeTab,
    dirtyTabs,
    ready,
    closeRequest,
    conflictId,
    selectTab,
    reorderTab,
    updateTab,
    restoreSession,
    registerViewer,
    getActiveViewer,
    openDialog,
    openPaths,
    saveTab,
    closeTab,
    cancelClose,
    saveAndResolveClose,
    discardAndResolveClose,
    cancelConflict,
    saveConflictCopy,
    reloadConflict
  } = useDocuments(showMessage, persistSession)

  const restorePreferences = useCallback((session: SessionState): void => {
    setHighlightColor(session.highlightColor || defaultHighlightColor)
    setTheme(session.theme || 'system')
  }, [])
  useDocumentSession({
    tabs,
    activeId,
    ready,
    highlightColor,
    theme,
    restoreSession,
    restorePreferences,
    showMessage
  })

  const { addImages, onImageDrop } = useImageInsertion({
    enabled: !!activeTab?.view.canAnnotate && !closeRequest && !conflictId,
    getActiveViewer,
    onToolChange: setAnnotationTool,
    onError: showMessage
  })

  useEffect(() => {
    window.lepis.setTheme(theme)
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    if (theme === 'system') {
      root.classList.add(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    } else {
      root.classList.add(theme)
    }
  }, [theme])

  const shortcutHandlers = useMemo<ShortcutHandlers>(() => {
    const withViewer = (action: (viewer: PdfDocumentHandle) => void): void => {
      const viewer = getActiveViewer()
      if (viewer) action(viewer)
    }
    const selectTabAtIndex = (index: number): void => {
      const tab = tabs[index]
      if (tab) selectTab(tab.id)
    }
    const cycleTab = (direction: number): void => {
      if (!tabs.length) return
      const index = tabs.findIndex((tab) => tab.id === activeId)
      selectTabAtIndex((index + direction + tabs.length) % tabs.length)
    }
    const turnPage = (direction: number): void => {
      if (!activeTab || !activeTab.view.pages) return
      const page = Math.min(activeTab.view.pages, Math.max(1, activeTab.view.page + direction))
      withViewer((viewer) => viewer.setPage(page))
    }
    return {
      open: () => void openDialog(),
      save: () => {
        if (activeId) void saveTab(activeId)
      },
      'close-tab': () => {
        if (activeId) void closeTab(activeId)
      },
      undo: () => withViewer((viewer) => viewer.undo()),
      redo: () => withViewer((viewer) => viewer.redo()),
      'toggle-sidebar': () => {
        if (activeTab) setSidebarOpen((open) => !open)
      },
      'zoom-in': () => withViewer((viewer) => viewer.zoomIn()),
      'zoom-out': () => withViewer((viewer) => viewer.zoomOut()),
      'next-tab': () => cycleTab(1),
      'previous-tab': () => cycleTab(-1),
      'tab-1': () => selectTabAtIndex(0),
      'tab-2': () => selectTabAtIndex(1),
      'tab-3': () => selectTabAtIndex(2),
      'tab-4': () => selectTabAtIndex(3),
      'tab-5': () => selectTabAtIndex(4),
      'tab-6': () => selectTabAtIndex(5),
      'tab-7': () => selectTabAtIndex(6),
      'tab-8': () => selectTabAtIndex(7),
      'tab-9': () => selectTabAtIndex(8),
      'previous-page': () => turnPage(-1),
      'next-page': () => turnPage(1),
      'navigate-left': () => withViewer((viewer) => viewer.navigateHorizontally(-1)),
      'navigate-right': () => withViewer((viewer) => viewer.navigateHorizontally(1))
    }
  }, [activeId, activeTab, closeTab, getActiveViewer, openDialog, saveTab, selectTab, tabs])

  useAppShortcuts(shortcutHandlers, ready && closeRequest === null && conflictId === null)

  const cycleTheme = (): void => {
    setTheme((current) =>
      current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system'
    )
  }

  return (
    <main
      className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
      onDragOver={(event) => event.preventDefault()}
      onDropCapture={onImageDrop}
      onDrop={(event) => {
        event.preventDefault()
        const paths = Array.from(event.dataTransfer.files)
          .filter(
            (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
          )
          .map((file) => window.lepis.getPathForFile(file))
          .filter(Boolean)
        void openPaths(paths)
      }}
    >
      <header className="shrink-0 border-b bg-background/95 backdrop-blur">
        <TabBar
          tabs={tabs}
          activeId={activeId}
          sidebarOpen={sidebarOpen}
          theme={theme}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onSelect={selectTab}
          onReorder={reorderTab}
          onClose={(id) => void closeTab(id)}
          onOpen={() => void openDialog()}
          onCycleTheme={cycleTheme}
        />
        <DocumentToolbar
          activeTab={activeTab}
          annotationTool={annotationTool}
          highlightColor={highlightColor}
          onAnnotationToolChange={setAnnotationTool}
          onHighlightColorChange={setHighlightColor}
          onAddImages={(files) => void addImages(files)}
          onPageChange={(page) => getActiveViewer()?.setPage(page)}
          onScaleChange={(scale) => getActiveViewer()?.setScale(scale)}
          onZoomIn={() => getActiveViewer()?.zoomIn()}
          onZoomOut={() => getActiveViewer()?.zoomOut()}
        />
      </header>

      <DocumentWorkspace
        tabs={tabs}
        activeId={activeId}
        ready={ready}
        sidebarOpen={sidebarOpen}
        annotationTool={annotationTool}
        highlightColor={highlightColor}
        onOpen={() => void openDialog()}
        onViewerHandle={registerViewer}
        onDirtyChange={(id, dirty) => updateTab(id, { dirty })}
        onSnapshot={(id, view) => updateTab(id, { view })}
        onError={(id, error) => updateTab(id, { error })}
      />

      {message && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg">
          {message}
        </div>
      )}

      <CloseDocumentsDialog
        open={closeRequest !== null && conflictId === null}
        closingWindow={closeRequest?.type === 'window'}
        documents={dirtyTabs}
        onCancel={cancelClose}
        onDiscard={() => void discardAndResolveClose()}
        onSave={() => void saveAndResolveClose()}
      />
      <FileConflictDialog
        open={conflictId !== null}
        onCancel={cancelConflict}
        onSaveCopy={() => void saveConflictCopy()}
        onReload={() => void reloadConflict()}
      />
    </main>
  )
}

export default App
