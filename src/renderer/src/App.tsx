import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  FileText,
  Highlighter,
  Minus,
  Monitor,
  Moon,
  Plus,
  Save,
  Sun,
  X
} from 'lucide-react'
import {
  PdfDocumentView,
  type PdfDocumentHandle,
  type ViewerSnapshot
} from '@/features/pdf/PdfDocumentView'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAppShortcuts } from '@/features/shortcuts/useAppShortcuts'
import type { ShortcutHandlers } from '../../shared/shortcuts'

const COLORS = [
  { name: 'Yellow', value: '#FDE047' },
  { name: 'Green', value: '#86EFAC' },
  { name: 'Blue', value: '#7DD3FC' },
  { name: 'Pink', value: '#F9A8D4' }
]

type OpenedPdf = {
  path: string
  name: string
  directoryName: string
  data: Uint8Array
  mtimeMs: number
  size: number
}

type SessionState = {
  activePath: string | null
  tabs: Array<{ path: string; page: number; scale: string; scrollTop: number }>
  highlightColor: string
  theme: 'system' | 'light' | 'dark'
}

type Tab = OpenedPdf & {
  id: string
  dirty: boolean
  unavailable: boolean
  error: string | null
  view: ViewerSnapshot
}

type CloseRequest = { type: 'tab'; id: string } | { type: 'window' } | null

function createTab(pdf: OpenedPdf, restored?: SessionState['tabs'][number]): Tab {
  return {
    ...pdf,
    id: crypto.randomUUID(),
    dirty: false,
    unavailable: false,
    error: null,
    view: {
      page: restored?.page ?? 1,
      pages: 0,
      scale: restored?.scale ?? 'page-width',
      zoomPercent: 100,
      scrollTop: restored?.scrollTop ?? 0,
      canAnnotate: false,
      signed: false
    }
  }
}

function App(): React.JSX.Element {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [highlightEnabled, setHighlightEnabled] = useState(false)
  const [highlightColor, setHighlightColor] = useState('#FDE047')
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system')
  const [closeRequest, setCloseRequest] = useState<CloseRequest>(null)
  const [conflictId, setConflictId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const refs = useRef(new Map<string, PdfDocumentHandle>())
  const tabsRef = useRef(tabs)
  const activeIdRef = useRef(activeId)
  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null
  const dirtyTabs = tabs.filter((tab) => tab.dirty)

  useEffect(() => {
    tabsRef.current = tabs
    activeIdRef.current = activeId
  }, [activeId, tabs])

  const updateTab = useCallback((id: string, changes: Partial<Tab>): void => {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...changes } : tab)))
  }, [])

  const showMessage = (text: string): void => {
    setMessage(text)
    window.setTimeout(() => setMessage((current) => (current === text ? null : current)), 3200)
  }

  const addOpenedPdfs = useCallback((pdfs: OpenedPdf[]): void => {
    if (pdfs.length === 0) return
    setTabs((current) => {
      const next = [...current]
      for (const pdf of pdfs) {
        const existing = next.find((tab) => tab.path === pdf.path)
        if (existing) {
          setActiveId(existing.id)
        } else {
          const tab = createTab(pdf)
          next.push(tab)
          setActiveId(tab.id)
        }
      }
      return next
    })
  }, [])

  const openDialog = useCallback(async (): Promise<void> => {
    try {
      addOpenedPdfs(await window.lepis.openPdfDialog())
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'The PDF could not be opened.')
    }
  }, [addOpenedPdfs])

  const openPath = useCallback(
    async (path: string, restored?: SessionState['tabs'][number]): Promise<Tab | null> => {
      const existing = tabsRef.current.find((tab) => tab.path === path)
      if (existing) {
        setActiveId(existing.id)
        return existing
      }
      try {
        const tab = createTab(await window.lepis.readPdf(path), restored)
        setTabs((current) => [...current, tab])
        return tab
      } catch {
        return null
      }
    },
    []
  )

  const saveTab = useCallback(async (id: string): Promise<boolean> => {
    const tab = tabsRef.current.find((candidate) => candidate.id === id)
    const viewer = refs.current.get(id)
    if (!tab || !viewer || !tab.dirty) return true
    try {
      const data = await viewer.saveDocument()
      const result = await window.lepis.savePdf({
        tabId: id,
        filePath: tab.path,
        data,
        expectedMtimeMs: tab.mtimeMs
      })
      setTabs((current) =>
        current.map((candidate) =>
          candidate.id === id
            ? { ...candidate, dirty: false, mtimeMs: result.mtimeMs, size: result.size }
            : candidate
        )
      )
      showMessage('Saved')
      return true
    } catch (error) {
      if (error instanceof Error && error.message.includes('FILE_CHANGED_EXTERNALLY')) {
        setConflictId(id)
      } else {
        showMessage(error instanceof Error ? error.message : 'The PDF could not be saved.')
      }
      return false
    }
  }, [])

  const closeTab = useCallback(async (id: string, discard = false): Promise<void> => {
    const current = tabsRef.current
    const tab = current.find((candidate) => candidate.id === id)
    if (!tab) return
    if (tab.dirty && !discard) {
      setCloseRequest({ type: 'tab', id })
      return
    }
    await window.lepis.closePdf(id)
    refs.current.delete(id)
    const index = current.findIndex((candidate) => candidate.id === id)
    const next = current.filter((candidate) => candidate.id !== id)
    setTabs(next)
    if (activeIdRef.current === id) {
      setActiveId(next[Math.min(index, next.length - 1)]?.id ?? null)
    }
  }, [])

  const requestWindowClose = useCallback((): void => {
    if (tabsRef.current.some((tab) => tab.dirty)) setCloseRequest({ type: 'window' })
    else {
      void Promise.all(tabsRef.current.map((tab) => window.lepis.closePdf(tab.id))).then(() =>
        window.lepis.confirmWindowClose()
      )
    }
  }, [])

  const saveAndResolveClose = async (): Promise<void> => {
    if (!closeRequest) return
    if (closeRequest.type === 'tab') {
      const saved = await saveTab(closeRequest.id)
      if (saved) {
        setCloseRequest(null)
        await closeTab(closeRequest.id, true)
      }
      return
    }
    for (const tab of tabsRef.current.filter((candidate) => candidate.dirty)) {
      if (!(await saveTab(tab.id))) return
    }
    await Promise.all(tabsRef.current.map((tab) => window.lepis.closePdf(tab.id)))
    setCloseRequest(null)
    window.lepis.confirmWindowClose()
  }

  useEffect(() => {
    let cancelled = false
    void window.lepis.loadSession().then(async (session) => {
      const restored: Tab[] = []
      for (const saved of session.tabs) {
        try {
          restored.push(createTab(await window.lepis.readPdf(saved.path), saved))
        } catch {
          // Missing files are omitted from the minimal session restore.
        }
      }
      if (cancelled) return
      setTabs(restored)
      const active = restored.find((tab) => tab.path === session.activePath) ?? restored[0]
      setActiveId(active?.id ?? null)
      setHighlightColor(session.highlightColor || '#FDE047')
      setTheme(session.theme || 'system')
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current)
    sessionTimerRef.current = setTimeout(() => {
      const state: SessionState = {
        activePath: tabs.find((tab) => tab.id === activeId)?.path ?? null,
        tabs: tabs.map((tab) => ({
          path: tab.path,
          page: tab.view.page,
          scale: tab.view.scale,
          scrollTop: tab.view.scrollTop
        })),
        highlightColor,
        theme
      }
      void window.lepis.saveSession(state)
    }, 250)
    return () => {
      if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current)
    }
  }, [activeId, highlightColor, ready, tabs, theme])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    if (theme === 'system') {
      root.classList.add(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    } else {
      root.classList.add(theme)
    }
  }, [theme])

  useEffect(() => {
    const cleanups = [
      window.lepis.onOpenRequested(
        (path) => void openPath(path).then((tab) => tab && setActiveId(tab.id))
      ),
      window.lepis.onCommand('window-close-requested', requestWindowClose)
    ]
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [openPath, requestWindowClose])

  useEffect(() => {
    const checkFiles = async (): Promise<void> => {
      for (const tab of tabsRef.current) {
        try {
          const stat = await window.lepis.statPdf(tab.path)
          if (Math.abs(stat.mtimeMs - tab.mtimeMs) <= 1) continue
          if (tab.dirty) {
            setConflictId(tab.id)
          } else {
            const fresh = await window.lepis.readPdf(tab.path)
            setTabs((current) =>
              current.map((candidate) =>
                candidate.id === tab.id ? { ...candidate, ...fresh, id: tab.id } : candidate
              )
            )
          }
        } catch {
          updateTab(tab.id, { unavailable: true })
        }
      }
    }
    window.addEventListener('focus', checkFiles)
    return () => window.removeEventListener('focus', checkFiles)
  }, [updateTab])

  const shortcutHandlers = useMemo<ShortcutHandlers>(() => {
    const withViewer = (action: (viewer: PdfDocumentHandle) => void): void => {
      const viewer = activeId ? refs.current.get(activeId) : undefined
      if (viewer) action(viewer)
    }
    const selectTab = (index: number): void => {
      const tab = tabs[index]
      if (tab) setActiveId(tab.id)
    }
    const cycleTab = (direction: number): void => {
      if (!tabs.length) return
      const index = tabs.findIndex((tab) => tab.id === activeId)
      selectTab((index + direction + tabs.length) % tabs.length)
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
      'zoom-in': () => withViewer((viewer) => viewer.zoomIn()),
      'zoom-out': () => withViewer((viewer) => viewer.zoomOut()),
      'next-tab': () => cycleTab(1),
      'previous-tab': () => cycleTab(-1),
      'tab-1': () => selectTab(0),
      'tab-2': () => selectTab(1),
      'tab-3': () => selectTab(2),
      'tab-4': () => selectTab(3),
      'tab-5': () => selectTab(4),
      'tab-6': () => selectTab(5),
      'tab-7': () => selectTab(6),
      'tab-8': () => selectTab(7),
      'tab-9': () => selectTab(8),
      'previous-page': () => turnPage(-1),
      'next-page': () => turnPage(1)
    }
  }, [activeId, activeTab, closeTab, openDialog, saveTab, tabs])

  useAppShortcuts(shortcutHandlers, ready && closeRequest === null && conflictId === null)

  const cycleTheme = (): void => {
    setTheme((current) =>
      current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system'
    )
  }

  const themeIcon = useMemo(() => {
    if (theme === 'light') return <Sun />
    if (theme === 'dark') return <Moon />
    return <Monitor />
  }, [theme])

  return (
    <main
      className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const paths = Array.from(event.dataTransfer.files)
          .filter(
            (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
          )
          .map((file) => window.lepis.getPathForFile(file))
          .filter(Boolean)
        void Promise.all(paths.map((path) => window.lepis.readPdf(path))).then(addOpenedPdfs)
      }}
    >
      <header className="shrink-0 border-b bg-background/95 backdrop-blur">
        <div className="titlebar-drag flex h-11 min-w-0 items-end pl-[78px]">
          <div className="titlebar-no-drag flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto px-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveId(tab.id)}
                className={cn(
                  'group relative flex h-9 max-w-72 shrink-0 items-center gap-2 rounded-t-md border border-b-0 px-3 text-left text-sm transition-colors',
                  tab.id === activeId
                    ? 'bg-background text-foreground'
                    : 'border-transparent bg-muted/35 text-muted-foreground hover:bg-muted/65'
                )}
                title={tab.path}
              >
                {tab.dirty && <span className="size-2 shrink-0 rounded-full bg-foreground" />}
                <span className="max-w-36 truncate font-medium">{tab.name}</span>
                <span className="max-w-24 truncate text-[11px] text-muted-foreground">
                  {tab.directoryName}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Close ${tab.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void closeTab(tab.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') void closeTab(tab.id)
                  }}
                  className="ml-auto grid size-5 place-items-center rounded opacity-0 hover:bg-muted group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </span>
              </button>
            ))}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="mb-1 shrink-0"
                  onClick={openDialog}
                >
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open PDF (⌘O)</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="titlebar-no-drag flex h-11 items-center gap-1 px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!activeTab?.dirty}
                onClick={() => activeId && void saveTab(activeId)}
              >
                <Save />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Save (⌘S)</TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={highlightEnabled ? 'secondary' : 'ghost'}
                size="icon-sm"
                disabled={!activeTab?.view.canAnnotate}
                onClick={() => setHighlightEnabled((value) => !value)}
              >
                <Highlighter />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {activeTab?.view.signed ? 'Signed PDFs are read-only' : 'Highlight text'}
            </TooltipContent>
          </Tooltip>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={!activeTab?.view.canAnnotate}
                className="gap-1.5 px-2"
              >
                <span
                  className="size-4 rounded-full border border-black/10"
                  style={{ backgroundColor: highlightColor }}
                />
                <ChevronDown className="size-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
              <div className="flex gap-1">
                {COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    aria-label={color.name}
                    onClick={() => setHighlightColor(color.value)}
                    className="relative grid size-8 place-items-center rounded-md hover:bg-muted"
                  >
                    <span
                      className="size-5 rounded-full border border-black/10"
                      style={{ backgroundColor: color.value }}
                    />
                    {highlightColor === color.value && (
                      <Check className="absolute size-3 text-black/70" />
                    )}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <div className="flex-1" />

          {activeTab && (
            <>
              <input
                aria-label="Current page"
                className="h-8 w-12 rounded-md border bg-transparent px-1 text-center text-sm"
                value={activeTab.view.page}
                onChange={(event) => {
                  const page = Number(event.target.value)
                  if (Number.isInteger(page) && page >= 1 && page <= activeTab.view.pages) {
                    refs.current.get(activeTab.id)?.setPage(page)
                  }
                }}
              />
              <span className="text-xs text-muted-foreground">/ {activeTab.view.pages || '—'}</span>
              <Separator orientation="vertical" className="mx-1 h-5" />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => refs.current.get(activeTab.id)?.zoomOut()}
              >
                <Minus />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="min-w-16">
                    {activeTab.view.zoomPercent}%
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="center" className="w-44 p-1">
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => refs.current.get(activeTab.id)?.setScale('page-width')}
                  >
                    Fit width
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => refs.current.get(activeTab.id)?.setScale('page-fit')}
                  >
                    Fit page
                  </Button>
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => refs.current.get(activeTab.id)?.zoomIn()}
              >
                <Plus />
              </Button>
            </>
          )}
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={cycleTheme}>
                {themeIcon}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Theme: {theme}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <section className="relative min-h-0 flex-1 bg-muted/45">
        {tabs.length === 0 && ready && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="grid size-14 place-items-center rounded-2xl border bg-background shadow-sm">
                <FileText className="size-6 text-muted-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Open a PDF</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Drop a document here or press ⌘O
                </p>
              </div>
              <Button onClick={openDialog}>Open PDF</Button>
            </div>
          </div>
        )}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn('absolute inset-0', tab.id === activeId ? 'visible' : 'invisible')}
          >
            <PdfDocumentView
              ref={(handle) => {
                if (handle) refs.current.set(tab.id, handle)
                else refs.current.delete(tab.id)
              }}
              data={tab.data}
              initialPage={tab.view.page}
              initialScale={tab.view.scale}
              initialScrollTop={tab.view.scrollTop}
              highlightEnabled={tab.id === activeId && highlightEnabled}
              highlightColor={highlightColor}
              onDirtyChange={(dirty) => updateTab(tab.id, { dirty })}
              onSnapshot={(view) => updateTab(tab.id, { view })}
              onError={(error) => updateTab(tab.id, { error })}
            />
          </div>
        ))}
      </section>

      {message && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg">
          {message}
        </div>
      )}

      <Dialog open={closeRequest !== null} onOpenChange={(open) => !open && setCloseRequest(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save changes before closing?</DialogTitle>
            <DialogDescription>
              {closeRequest?.type === 'window' && dirtyTabs.length > 1
                ? `${dirtyTabs.length} documents have unsaved highlights.`
                : 'This document has unsaved highlights.'}
            </DialogDescription>
          </DialogHeader>
          {closeRequest?.type === 'window' && dirtyTabs.length > 1 && (
            <div className="max-h-40 overflow-auto rounded-md border p-2 text-sm">
              {dirtyTabs.map((tab) => (
                <div key={tab.id} className="truncate py-1">
                  {tab.name}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCloseRequest(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const request = closeRequest
                setCloseRequest(null)
                if (request?.type === 'tab') void closeTab(request.id, true)
                else {
                  void Promise.all(
                    tabsRef.current.map((tab) => window.lepis.closePdf(tab.id))
                  ).then(() => window.lepis.confirmWindowClose())
                }
              }}
            >
              Close without saving
            </Button>
            <Button onClick={() => void saveAndResolveClose()}>Save and close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={conflictId !== null} onOpenChange={(open) => !open && setConflictId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>The file changed on disk</DialogTitle>
            <DialogDescription>
              Another application modified this PDF. Reloading discards the unsaved highlights in
              Lepis. You can also preserve the Lepis version as a separate PDF.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConflictId(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const id = conflictId
                const tab = tabsRef.current.find((candidate) => candidate.id === id)
                const viewer = id ? refs.current.get(id) : null
                if (!id || !tab || !viewer) return
                void viewer.saveDocument().then(async (data) => {
                  const saved = await window.lepis.savePdfAs({
                    data,
                    suggestedName: tab.name.replace(/\.pdf$/i, ' - Lepis.pdf')
                  })
                  if (!saved) return
                  await window.lepis.closePdf(id)
                  setTabs((current) =>
                    current.map((candidate) =>
                      candidate.id === id
                        ? { ...createTab(saved), id, view: candidate.view }
                        : candidate
                    )
                  )
                  setConflictId(null)
                  showMessage('Saved as a copy')
                })
              }}
            >
              Save as copy
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const id = conflictId
                const tab = tabsRef.current.find((candidate) => candidate.id === id)
                if (!id || !tab) return
                void window.lepis.readPdf(tab.path).then((fresh) => {
                  setTabs((current) =>
                    current.map((candidate) =>
                      candidate.id === id
                        ? { ...createTab(fresh), id, view: candidate.view }
                        : candidate
                    )
                  )
                  setConflictId(null)
                })
              }}
            >
              Reload and discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

export default App
