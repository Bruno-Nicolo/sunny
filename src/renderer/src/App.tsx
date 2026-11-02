import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnnotationTool } from '@/features/pdf/annotations/types'
import type { TextEditorSettings } from '@/features/pdf/annotations/text/types'
import { useAppShortcuts } from '@/features/shortcuts/useAppShortcuts'
import type { ShortcutHandlers } from '../../shared/shortcuts'
import type { SessionState } from '../../shared/contracts'
import type { PdfDocumentHandle, PdfDocumentViewProps } from '@/features/pdf/types'
import type { DocumentsState } from '@/features/documents/documentsReducer'
import { useDocuments } from '@/features/documents/useDocuments'
import { persistDocumentSession, useDocumentSession } from '@/features/session/useDocumentSession'
import { TabBar } from '@/features/documents/components/TabBar'
import { DocumentToolbar } from '@/features/documents/components/DocumentToolbar'
import { DocumentWorkspace } from '@/features/documents/components/DocumentWorkspace'
import { CloseDocumentsDialog } from '@/features/documents/components/CloseDocumentsDialog'
import { RecoveryDialog } from '@/features/documents/components/RecoveryDialog'
import { FileConflictDialog } from '@/features/documents/components/FileConflictDialog'
import { useAnnotationInsertion } from '@/features/pdf/annotations/useAnnotationInsertion'
import { defaultHighlightColor } from '@/features/pdf/annotations/highlight/colors'
import type { ChatAttachment } from '../../shared/ai'
import { ChatDock } from '@/features/chat/ChatDock'

function App(): React.JSX.Element {
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('none')
  const [textEditor, setTextEditor] = useState<{
    id: string
    settings: TextEditorSettings | null
  } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [invertColors, setInvertColors] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<PdfDocumentViewProps['sidebarTab']>('pages')
  const [highlightColor, setHighlightColor] = useState<string>(defaultHighlightColor)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatSelection, setChatSelection] = useState<{
    tabId: string
    attachments: ChatAttachment[]
  } | null>(null)
  const consumeChatSelection = useCallback(() => setChatSelection(null), [])
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
    recoveryDrafts,
    recoverDrafts,
    discardDrafts,
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
  const chatViewers = useRef(new Map<string, PdfDocumentHandle>())
  const registerDocumentViewer = useCallback(
    (id: string, handle: PdfDocumentHandle | null): void => {
      registerViewer(id, handle)
      if (handle) chatViewers.current.set(id, handle)
      else chatViewers.current.delete(id)
    },
    [registerViewer]
  )
  const getChatViewer = useCallback(
    (id: string): PdfDocumentHandle | null => chatViewers.current.get(id) ?? null,
    []
  )

  const onTextEditorChange = useCallback(
    (id: string, settings: TextEditorSettings | null): void => {
      if (id === activeId) setTextEditor({ id, settings })
    },
    [activeId]
  )

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

  const { addImages, onImageDrop } = useAnnotationInsertion({
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

  const shortcutHandlers = useMemo(() => {
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
      print: () =>
        withViewer((viewer) => {
          void viewer.print().catch((error: unknown) => {
            showMessage(error instanceof Error ? error.message : 'The PDF could not be printed.')
          })
        }),
      'close-tab': () => {
        if (activeId) void closeTab(activeId)
      },
      undo: () => withViewer((viewer) => viewer.undo()),
      redo: () => withViewer((viewer) => viewer.redo()),
      find: () => withViewer((viewer) => viewer.openSearch()),
      'toggle-sidebar': () => {
        if (activeTab) setSidebarOpen((open) => !open)
      },
      'toggle-chat': () => {
        if (activeTab) setChatOpen((open) => !open)
      },
      'zoom-in': () => withViewer((viewer) => viewer.zoomIn()),
      'zoom-out': () => withViewer((viewer) => viewer.zoomOut()),
      'rotate-clockwise': () => withViewer((viewer) => viewer.rotateClockwise()),
      'toggle-invert-colors': () => {
        if (activeTab?.view.pages) setInvertColors((inverted) => !inverted)
      },
      'activate-highlight': () => {
        if (activeTab?.view.canAnnotate) setAnnotationTool('highlight')
      },
      'activate-text': () => {
        if (activeTab?.view.canAnnotate) setAnnotationTool('text')
      },
      'deactivate-tool': () => setAnnotationTool('none'),
      'toggle-two-page-view': () => withViewer((viewer) => viewer.toggleTwoPageView()),
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
      'navigate-right': () => withViewer((viewer) => viewer.navigateHorizontally(1)),
      'navigate-up': () => withViewer((viewer) => viewer.scrollVertically(-1)),
      'navigate-down': () => withViewer((viewer) => viewer.scrollVertically(1))
    } satisfies ShortcutHandlers
  }, [
    activeId,
    activeTab,
    closeTab,
    getActiveViewer,
    openDialog,
    saveTab,
    selectTab,
    showMessage,
    tabs
  ])

  useAppShortcuts(
    shortcutHandlers,
    ready &&
      recoveryDrafts !== null &&
      recoveryDrafts.length === 0 &&
      closeRequest === null &&
      conflictId === null
  )

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
      {tabs.length > 0 ? (
        <header className="shrink-0 border-b bg-background/95 backdrop-blur">
          <TabBar
            tabs={tabs}
            activeId={activeId}
            sidebarOpen={sidebarOpen}
            theme={theme}
            chatOpen={chatOpen}
            onToggleChat={() => setChatOpen((open) => !open)}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
            onSelect={selectTab}
            onReorder={reorderTab}
            onClose={(id) => void closeTab(id)}
            onOpen={() => void openDialog()}
            onCycleTheme={cycleTheme}
          />
          <DocumentToolbar
            activeTab={activeTab}
            invertColors={invertColors}
            annotationTool={annotationTool}
            highlightColor={highlightColor}
            textSettings={textEditor?.id === activeId ? textEditor.settings : null}
            onAnnotationToolChange={setAnnotationTool}
            onHighlightColorChange={(color) => {
              getActiveViewer()?.setHighlightColor(color)
              setHighlightColor(color)
            }}
            onAddImages={(files) => void addImages(files)}
            onPageChange={(page) => getActiveViewer()?.setPage(page)}
            onScaleChange={(scale) => getActiveViewer()?.setScale(scale)}
            onZoomIn={() => getActiveViewer()?.zoomIn()}
            onZoomOut={() => getActiveViewer()?.zoomOut()}
            onRotateClockwise={() => getActiveViewer()?.rotateClockwise()}
            onToggleTwoPageView={() => getActiveViewer()?.toggleTwoPageView()}
            onToggleInvertColors={shortcutHandlers['toggle-invert-colors']}
            onStartPresentation={() => void getActiveViewer()?.startPresentation()}
          />
        </header>
      ) : (
        <div aria-hidden="true" className="titlebar-drag absolute inset-x-0 top-0 z-10 h-12" />
      )}

      <ChatDock
        selection={chatSelection}
        onSelectionConsumed={consumeChatSelection}
        open={chatOpen}
        onOpenChange={setChatOpen}
        tabs={tabs}
        activeId={activeId}
        getViewer={getChatViewer}
        onSelectionTool={() => setAnnotationTool('none')}
      >
        <DocumentWorkspace
          onAskAI={(attachments) => {
            if (!activeId) return
            setChatSelection({ tabId: activeId, attachments })
            setChatOpen(true)
          }}
          tabs={tabs}
          invertColors={invertColors}
          activeId={activeId}
          ready={ready}
          sidebarOpen={sidebarOpen}
          sidebarTab={sidebarTab}
          onSidebarTabChange={setSidebarTab}
          annotationTool={annotationTool}
          highlightColor={highlightColor}
          onOpen={() => void openDialog()}
          onOpenPath={(path) => openPaths([path])}
          onViewerHandle={registerDocumentViewer}
          onDirtyChange={(id, dirty) => updateTab(id, { dirty })}
          onSnapshot={(id, view) => updateTab(id, { view })}
          onError={(id, error) => updateTab(id, { error })}
          onTextEditorChange={onTextEditorChange}
        />
      </ChatDock>

      {message && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg">
          {message}
        </div>
      )}

      <RecoveryDialog
        drafts={recoveryDrafts ?? []}
        onRecover={recoverDrafts}
        onDiscard={discardDrafts}
      />
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
