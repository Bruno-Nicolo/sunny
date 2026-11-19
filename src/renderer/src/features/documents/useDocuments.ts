import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { OpenedPdf, PdfCopyDestination, PdfDraft } from '../../../../shared/contracts'
import type { PdfDocumentHandle } from '@/features/pdf/types'
import { createDraftAutosave } from './draftAutosave'
import {
  createTab,
  documentsReducer,
  initialDocumentsState,
  type DocumentsState,
  type TabChanges
} from './documentsReducer'
import type { CloseRequest, Tab } from './types'

type PageSave = { data: Uint8Array; page: number; onSaved(): void }

type DocumentsController = DocumentsState & {
  activeTab: Tab | null
  dirtyTabs: Tab[]
  closeRequest: CloseRequest
  conflictId: string | null
  recoveryDrafts: PdfDraft[] | null
  recoverDrafts(): Promise<void>
  discardDrafts(): Promise<void>
  selectTab(id: string): void
  reorderTab(id: string, index: number): void
  updateTab(id: string, changes: TabChanges): void
  restoreSession(tabs: Tab[], activePath: string | null): void
  registerViewer(id: string, viewer: PdfDocumentHandle | null): void
  getActiveViewer(): PdfDocumentHandle | undefined
  openDialog(): Promise<void>
  openPaths(paths: string[]): Promise<void>
  exportPages(id: string, data: Uint8Array): Promise<boolean>
  printTab(id: string, mode: 'print' | 'flatten'): Promise<void>
  saveTab(id: string, pages?: PageSave): Promise<boolean>
  closeTab(id: string, discard?: boolean): Promise<boolean>
  cancelClose(): void
  saveAndResolveClose(): Promise<void>
  discardAndResolveClose(): Promise<void>
  cancelConflict(): void
  saveConflictCopy(): Promise<void>
  reloadConflict(): Promise<void>
}

function copyDestination(name: string, suffix: string, tabs: Tab[]): PdfCopyDestination {
  return {
    suggestedName: `${name.replace(/\.pdf$/i, '')} - ${suffix}.pdf`,
    excludedPaths: tabs.map((tab) => tab.path)
  }
}

export function useDocuments(
  showMessage: (message: string) => void,
  persistSession: (state: DocumentsState) => Promise<void>
): DocumentsController {
  const [state, dispatch] = useReducer(documentsReducer, initialDocumentsState)
  const [closeRequest, setCloseRequest] = useState<CloseRequest>(null)
  const [conflictId, setConflictId] = useState<string | null>(null)
  const [recoveryDrafts, setRecoveryDrafts] = useState<PdfDraft[] | null>(null)
  const stateRef = useRef(state)
  const viewers = useRef(new Map<string, PdfDocumentHandle>())

  const [draftAutosave] = useState(createDraftAutosave)

  useEffect(() => {
    let cancelled = false
    void window.lepis
      .loadDrafts()
      .then((drafts) => {
        if (!cancelled) setRecoveryDrafts(drafts)
      })
      .catch(() => {
        if (!cancelled) {
          setRecoveryDrafts([])
          showMessage('Recovery copies could not be loaded.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [showMessage])

  useEffect(() => {
    if (!state.ready || recoveryDrafts === null || recoveryDrafts.length) return
    const timer = setInterval(
      () =>
        void draftAutosave.tick({
          getTabs: () => stateRef.current.tabs,
          getViewer: (id) => viewers.current.get(id),
          save: (draft) => window.lepis.saveDraft(draft),
          onError: showMessage
        }),
      3000
    )
    return () => clearInterval(timer)
  }, [draftAutosave, recoveryDrafts, showMessage, state.ready])

  const recoverDrafts = useCallback(async (): Promise<void> => {
    if (!recoveryDrafts) return
    const recovered: Tab[] = []
    for (const draft of recoveryDrafts) {
      const current = stateRef.current.tabs.find((tab) => tab.path === draft.path)
      if (current?.dirty) {
        showMessage('Save or close the edited document before recovering its previous changes.')
        return
      }
      const tab = createTab(draft)
      tab.dirty = true
      try {
        await window.lepis.statPdf(draft.path)
      } catch {
        tab.unavailable = true
      }
      recovered.push(tab)
    }
    dispatch({ type: 'recover', tabs: recovered })
    setRecoveryDrafts([])
    showMessage('Unsaved changes recovered. Save to keep them in the original PDF.')
  }, [recoveryDrafts, showMessage])

  const discardDrafts = useCallback(async (): Promise<void> => {
    try {
      for (const draft of recoveryDrafts ?? []) await window.lepis.deleteDraft(draft.path)
      setRecoveryDrafts([])
    } catch {
      showMessage('Recovery copies could not be discarded. Try again.')
    }
  }, [recoveryDrafts, showMessage])

  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  const selectTab = useCallback((id: string): void => dispatch({ type: 'select', id }), [])
  const reorderTab = useCallback((id: string, index: number): void => {
    dispatch({ type: 'reorder', id, index })
  }, [])
  const updateTab = useCallback((id: string, changes: TabChanges): void => {
    dispatch({ type: 'update', id, changes })
  }, [])
  const restoreSession = useCallback((tabs: Tab[], activePath: string | null): void => {
    dispatch({ type: 'restore', tabs, activePath })
  }, [])
  const registerViewer = useCallback((id: string, viewer: PdfDocumentHandle | null): void => {
    if (viewer) viewers.current.set(id, viewer)
    else viewers.current.delete(id)
  }, [])
  const getActiveViewer = useCallback((): PdfDocumentHandle | undefined => {
    const id = stateRef.current.activeId
    return id ? viewers.current.get(id) : undefined
  }, [])
  const addOpenedPdfs = useCallback((pdfs: OpenedPdf[]): void => {
    dispatch({ type: 'open', tabs: pdfs.map((pdf) => createTab(pdf)) })
  }, [])

  const confirmActivePageChanges = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeId)
    return (
      !current?.pageDraft || (await viewers.current.get(current.id)?.confirmPageChanges()) === true
    )
  }, [])

  const openDialog = useCallback(async (): Promise<void> => {
    if (!(await confirmActivePageChanges())) return
    try {
      addOpenedPdfs(await window.lepis.openPdfDialog())
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'The PDF could not be opened.')
    }
  }, [addOpenedPdfs, confirmActivePageChanges, showMessage])

  const openPaths = useCallback(
    async (paths: string[]): Promise<void> => {
      if (!(await confirmActivePageChanges())) return
      // Keep successful documents when one of the requested paths is unavailable.
      const results = await Promise.allSettled(
        paths.map((path) => {
          const existing = stateRef.current.tabs.find((tab) => tab.path === path)
          return existing ? Promise.resolve(existing) : window.lepis.readPdf(path)
        })
      )
      const pdfs: OpenedPdf[] = []
      for (const result of results) {
        if (result.status === 'fulfilled') pdfs.push(result.value)
        else
          showMessage(
            result.reason instanceof Error ? result.reason.message : 'The PDF could not be opened.'
          )
      }
      addOpenedPdfs(pdfs)
    },
    [addOpenedPdfs, confirmActivePageChanges, showMessage]
  )

  const saveTab = useCallback(
    async (id: string, pages?: PageSave): Promise<boolean> => {
      const tab = stateRef.current.tabs.find((candidate) => candidate.id === id)
      if (!tab) return false
      if (!tab.dirty && !pages) return true
      const viewer = viewers.current.get(id)
      if (!viewer) {
        showMessage('The PDF is not ready for saving.')
        return false
      }
      if (tab.unavailable) {
        setConflictId(id)
        return false
      }
      return draftAutosave.withPaused([id], async () => {
        try {
          const saving = pages?.data ?? viewer.saveDocument()
          const revision = viewer.revision
          const data = await saving
          const stats = await window.lepis.savePdf({
            tabId: id,
            filePath: tab.path,
            data,
            expectedMtimeMs: tab.mtimeMs
          })
          const dirty = !pages && viewer.revision !== revision
          if (pages) {
            pages.onSaved()
            dispatch({
              type: 'replace',
              id,
              pdf: { ...tab, ...stats, source: { kind: 'memory', data: data.slice().buffer } },
              page: pages.page
            })
          } else dispatch({ type: 'saved', id, stats, dirty })
          if (!dirty) {
            try {
              await window.lepis.deleteDraft(tab.path)
            } catch {
              showMessage('Saved. The recovery copy could not be removed.')
              return true
            }
          }
          showMessage(dirty ? 'Saved. Newer changes are still unsaved.' : 'Saved')
          return !dirty
        } catch (error) {
          if (error instanceof Error && error.message.includes('FILE_CHANGED_EXTERNALLY'))
            setConflictId(id)
          else showMessage(error instanceof Error ? error.message : 'The PDF could not be saved.')
          return false
        }
      })
    },
    [draftAutosave, showMessage]
  )

  const exportPages = useCallback(async (id: string, data: Uint8Array): Promise<boolean> => {
    const tab = stateRef.current.tabs.find((candidate) => candidate.id === id)
    if (!tab) return false
    const saved = await window.lepis.savePdfAs({
      data,
      ...copyDestination(tab.name, 'pages', stateRef.current.tabs)
    })
    return saved !== null
  }, [])

  const printTab = useCallback(
    async (id: string, mode: 'print' | 'flatten'): Promise<void> => {
      const tab = stateRef.current.tabs.find((candidate) => candidate.id === id)
      const viewer = viewers.current.get(id)
      if (!tab || !viewer) return
      const destination =
        mode === 'flatten'
          ? copyDestination(tab.name, 'flattened', stateRef.current.tabs)
          : undefined
      try {
        if ((await viewer.print(destination)) && destination) showMessage('Flattened PDF exported.')
      } catch (error) {
        showMessage(
          error instanceof Error
            ? error.message
            : destination
              ? 'The flattened PDF could not be exported.'
              : 'The PDF could not be printed.'
        )
      }
    },
    [showMessage]
  )

  const closeTab = useCallback(
    async (id: string, discard = false): Promise<boolean> => {
      let tab = stateRef.current.tabs.find((candidate) => candidate.id === id)
      if (!tab) return true
      if (tab.pageDraft) {
        if (!(await viewers.current.get(id)?.confirmPageChanges())) return false
        tab = stateRef.current.tabs.find((candidate) => candidate.id === id)
        if (!tab) return true
      }
      if (tab.dirty && !discard) {
        setCloseRequest({ type: 'tab', id })
        return false
      }
      return draftAutosave.withPaused([id], async () => {
        try {
          await window.lepis.closePdf(id)
          const current = stateRef.current.tabs.find((candidate) => candidate.id === id)
          if (current?.dirty && !discard) {
            setCloseRequest({ type: 'tab', id })
            return false
          }
          await window.lepis.deleteDraft(tab.path)
          viewers.current.delete(id)
          dispatch({ type: 'close', id })
          return true
        } catch (error) {
          showMessage(error instanceof Error ? error.message : 'The PDF could not be closed.')
          return false
        }
      })
    },
    [draftAutosave, showMessage]
  )

  const finishWindowClose = useCallback(
    async (discard = false): Promise<void> => {
      const closing = stateRef.current.tabs
      return draftAutosave.withPaused(
        closing.map((tab) => tab.id),
        async () => {
          try {
            await Promise.all(stateRef.current.tabs.map((tab) => window.lepis.closePdf(tab.id)))
            if (!discard && stateRef.current.tabs.some((tab) => tab.dirty)) {
              setCloseRequest({ type: 'window' })
              return
            }
            await persistSession(stateRef.current)
            if (!discard && stateRef.current.tabs.some((tab) => tab.dirty)) {
              setCloseRequest({ type: 'window' })
              return
            }
            if (recoveryDrafts !== null && recoveryDrafts.length === 0)
              await Promise.all(closing.map((tab) => window.lepis.deleteDraft(tab.path)))
            setCloseRequest(null)
            window.lepis.confirmWindowClose()
          } catch (error) {
            showMessage(error instanceof Error ? error.message : 'The window could not be closed.')
          }
        }
      )
    },
    [draftAutosave, persistSession, recoveryDrafts, showMessage]
  )

  const requestWindowClose = useCallback(async (): Promise<void> => {
    for (const tab of stateRef.current.tabs) {
      if (tab.pageDraft && !(await viewers.current.get(tab.id)?.confirmPageChanges())) return
    }
    if (stateRef.current.tabs.some((tab) => tab.dirty)) setCloseRequest({ type: 'window' })
    else void finishWindowClose()
  }, [finishWindowClose])

  const saveAndResolveClose = useCallback(async (): Promise<void> => {
    if (!closeRequest) return
    if (closeRequest.type === 'tab') {
      if (await saveTab(closeRequest.id)) {
        if (await closeTab(closeRequest.id, true)) setCloseRequest(null)
      }
      return
    }
    for (const tab of stateRef.current.tabs.filter((candidate) => candidate.dirty)) {
      if (!(await saveTab(tab.id))) return
    }
    await finishWindowClose()
  }, [closeRequest, closeTab, finishWindowClose, saveTab])

  const discardAndResolveClose = useCallback(async (): Promise<void> => {
    if (!closeRequest) return
    if (closeRequest.type === 'tab') {
      if (await closeTab(closeRequest.id, true)) setCloseRequest(null)
    } else await finishWindowClose(true)
  }, [closeRequest, closeTab, finishWindowClose])

  const saveConflictCopy = useCallback(async (): Promise<void> => {
    const id = conflictId
    const tab = stateRef.current.tabs.find((candidate) => candidate.id === id)
    const viewer = id ? viewers.current.get(id) : undefined
    if (!id || !tab || !viewer) return
    return draftAutosave.withPaused([id], async () => {
      try {
        const pending = await viewer.preparePageChanges()
        const data = pending?.data ?? (await viewer.saveDocument())
        const path = await window.lepis.savePdfAs({
          data,
          ...copyDestination(tab.name, 'Sunny', stateRef.current.tabs)
        })
        if (!path) return
        const saved = await window.lepis.readPdf(path)
        await window.lepis.closePdf(id)
        await window.lepis.deleteDraft(tab.path)
        dispatch({ type: 'replace', id, pdf: saved, page: pending?.page })
        setConflictId(null)
        showMessage('Saved as a copy')
      } catch (error) {
        showMessage(
          error instanceof Error ? error.message : 'The PDF could not be saved as a copy.'
        )
      }
    })
  }, [conflictId, draftAutosave, showMessage])

  const reloadConflict = useCallback(async (): Promise<void> => {
    const id = conflictId
    const tab = stateRef.current.tabs.find((candidate) => candidate.id === id)
    if (!id || !tab) return
    return draftAutosave.withPaused([id], async () => {
      try {
        const fresh = await window.lepis.readPdf(tab.path)
        await window.lepis.deleteDraft(tab.path)
        dispatch({ type: 'replace', id, pdf: fresh })
        setConflictId(null)
      } catch (error) {
        showMessage(error instanceof Error ? error.message : 'The PDF could not be reloaded.')
      }
    })
  }, [conflictId, draftAutosave, showMessage])

  useEffect(() => {
    const cleanups = [
      window.lepis.onOpenRequested((path) => void openPaths([path])),
      window.lepis.onCommand('window-close-requested', requestWindowClose)
    ]
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [openPaths, requestWindowClose])

  useEffect(() => {
    let checking = false
    let cancelled = false
    const checkFiles = async (): Promise<void> => {
      if (checking) return
      checking = true
      try {
        for (const tab of stateRef.current.tabs) {
          try {
            const stats = await window.lepis.statPdf(tab.path)
            if (cancelled) return
            const current = stateRef.current.tabs.find((candidate) => candidate.id === tab.id)
            if (!current || current.source !== tab.source || current.mtimeMs !== tab.mtimeMs)
              continue
            if (Math.abs(stats.mtimeMs - current.mtimeMs) <= 1) {
              if (current.unavailable) updateTab(tab.id, { unavailable: false })
              continue
            }
            if (current.dirty || current.pageDraft) {
              setConflictId(tab.id)
            } else {
              const fresh = await window.lepis.readPdf(tab.path)
              const latest = stateRef.current.tabs.find((candidate) => candidate.id === tab.id)
              if (
                cancelled ||
                !latest ||
                latest.source !== tab.source ||
                latest.mtimeMs !== tab.mtimeMs
              )
                continue
              if (latest.dirty || latest.pageDraft) setConflictId(tab.id)
              else dispatch({ type: 'replace', id: tab.id, pdf: fresh })
            }
          } catch {
            if (!cancelled) updateTab(tab.id, { unavailable: true })
          }
        }
      } finally {
        checking = false
      }
    }
    window.addEventListener('focus', checkFiles)
    return () => {
      cancelled = true
      window.removeEventListener('focus', checkFiles)
    }
  }, [updateTab])

  return {
    ...state,
    recoveryDrafts,
    recoverDrafts,
    discardDrafts,
    activeTab: state.tabs.find((tab) => tab.id === state.activeId) ?? null,
    dirtyTabs: state.tabs.filter((tab) => tab.dirty),
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
    exportPages,
    printTab,
    closeTab,
    saveAndResolveClose,
    discardAndResolveClose,
    saveConflictCopy,
    reloadConflict,
    cancelClose: () => setCloseRequest(null),
    cancelConflict: () => setConflictId(null)
  }
}
