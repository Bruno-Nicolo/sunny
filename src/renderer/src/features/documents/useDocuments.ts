import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { OpenedPdf } from '../../../../shared/contracts'
import type { PdfDocumentHandle } from '@/features/pdf/types'
import {
  createTab,
  documentsReducer,
  initialDocumentsState,
  type DocumentsState,
  type TabChanges
} from './documentsReducer'
import type { CloseRequest, Tab } from './types'

type DocumentsController = DocumentsState & {
  activeTab: Tab | null
  dirtyTabs: Tab[]
  closeRequest: CloseRequest
  conflictId: string | null
  selectTab(id: string): void
  updateTab(id: string, changes: TabChanges): void
  restoreSession(tabs: Tab[], activePath: string | null): void
  registerViewer(id: string, viewer: PdfDocumentHandle | null): void
  getActiveViewer(): PdfDocumentHandle | undefined
  openDialog(): Promise<void>
  openPaths(paths: string[]): Promise<void>
  saveTab(id: string): Promise<boolean>
  closeTab(id: string, discard?: boolean): Promise<boolean>
  cancelClose(): void
  saveAndResolveClose(): Promise<void>
  discardAndResolveClose(): Promise<void>
  cancelConflict(): void
  saveConflictCopy(): Promise<void>
  reloadConflict(): Promise<void>
}

export function useDocuments(
  showMessage: (message: string) => void,
  persistSession: (state: DocumentsState) => Promise<void>
): DocumentsController {
  const [state, dispatch] = useReducer(documentsReducer, initialDocumentsState)
  const [closeRequest, setCloseRequest] = useState<CloseRequest>(null)
  const [conflictId, setConflictId] = useState<string | null>(null)
  const stateRef = useRef(state)
  const viewers = useRef(new Map<string, PdfDocumentHandle>())

  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  const selectTab = useCallback((id: string): void => dispatch({ type: 'select', id }), [])
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

  const openDialog = useCallback(async (): Promise<void> => {
    try {
      addOpenedPdfs(await window.lepis.openPdfDialog())
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'The PDF could not be opened.')
    }
  }, [addOpenedPdfs, showMessage])

  const openPaths = useCallback(
    async (paths: string[]): Promise<void> => {
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
    [addOpenedPdfs, showMessage]
  )

  const saveTab = useCallback(
    async (id: string): Promise<boolean> => {
      const tab = stateRef.current.tabs.find((candidate) => candidate.id === id)
      if (!tab) return false
      if (!tab.dirty) return true
      const viewer = viewers.current.get(id)
      if (!viewer) {
        showMessage('The PDF is not ready for saving.')
        return false
      }
      try {
        const data = await viewer.saveDocument()
        const stats = await window.lepis.savePdf({
          tabId: id,
          filePath: tab.path,
          data,
          expectedMtimeMs: tab.mtimeMs
        })
        dispatch({ type: 'saved', id, stats })
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
    },
    [showMessage]
  )

  const closeTab = useCallback(
    async (id: string, discard = false): Promise<boolean> => {
      const tab = stateRef.current.tabs.find((candidate) => candidate.id === id)
      if (!tab) return true
      if (tab.dirty && !discard) {
        setCloseRequest({ type: 'tab', id })
        return false
      }
      try {
        await window.lepis.closePdf(id)
        const current = stateRef.current.tabs.find((candidate) => candidate.id === id)
        if (current?.dirty && !discard) {
          setCloseRequest({ type: 'tab', id })
          return false
        }
        viewers.current.delete(id)
        dispatch({ type: 'close', id })
        return true
      } catch (error) {
        showMessage(error instanceof Error ? error.message : 'The PDF could not be closed.')
        return false
      }
    },
    [showMessage]
  )

  const finishWindowClose = useCallback(
    async (discard = false): Promise<void> => {
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
        setCloseRequest(null)
        window.lepis.confirmWindowClose()
      } catch (error) {
        showMessage(error instanceof Error ? error.message : 'The window could not be closed.')
      }
    },
    [persistSession, showMessage]
  )

  const requestWindowClose = useCallback((): void => {
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
    try {
      const data = await viewer.saveDocument()
      const saved = await window.lepis.savePdfAs({
        data,
        suggestedName: tab.name.replace(/\.pdf$/i, ' - Lepis.pdf')
      })
      if (!saved) return
      await window.lepis.closePdf(id)
      dispatch({ type: 'replace', id, pdf: saved })
      setConflictId(null)
      showMessage('Saved as a copy')
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'The PDF could not be saved as a copy.')
    }
  }, [conflictId, showMessage])

  const reloadConflict = useCallback(async (): Promise<void> => {
    const id = conflictId
    const tab = stateRef.current.tabs.find((candidate) => candidate.id === id)
    if (!id || !tab) return
    try {
      const fresh = await window.lepis.readPdf(tab.path)
      dispatch({ type: 'replace', id, pdf: fresh })
      setConflictId(null)
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'The PDF could not be reloaded.')
    }
  }, [conflictId, showMessage])

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
            if (!current || current.data !== tab.data || current.mtimeMs !== tab.mtimeMs) continue
            if (Math.abs(stats.mtimeMs - current.mtimeMs) <= 1) {
              if (current.unavailable) updateTab(tab.id, { unavailable: false })
              continue
            }
            if (current.dirty) {
              setConflictId(tab.id)
            } else {
              const fresh = await window.lepis.readPdf(tab.path)
              const latest = stateRef.current.tabs.find((candidate) => candidate.id === tab.id)
              if (
                cancelled ||
                !latest ||
                latest.data !== tab.data ||
                latest.mtimeMs !== tab.mtimeMs
              )
                continue
              if (latest.dirty) setConflictId(tab.id)
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
    activeTab: state.tabs.find((tab) => tab.id === state.activeId) ?? null,
    dirtyTabs: state.tabs.filter((tab) => tab.dirty),
    closeRequest,
    conflictId,
    selectTab,
    updateTab,
    restoreSession,
    registerViewer,
    getActiveViewer,
    openDialog,
    openPaths,
    saveTab,
    closeTab,
    saveAndResolveClose,
    discardAndResolveClose,
    saveConflictCopy,
    reloadConflict,
    cancelClose: () => setCloseRequest(null),
    cancelConflict: () => setConflictId(null)
  }
}
