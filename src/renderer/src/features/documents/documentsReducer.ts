import type { OpenedPdf, PdfFileStats, SessionTab } from '../../../../shared/contracts'
import type { Tab } from './types'

export type DocumentsState = {
  tabs: Tab[]
  activeId: string | null
  ready: boolean
}

export type TabChanges = Partial<Pick<Tab, 'dirty' | 'unavailable' | 'error' | 'view'>>

export type DocumentsAction =
  | { type: 'open'; tabs: Tab[] }
  | { type: 'recover'; tabs: Tab[] }
  | { type: 'select'; id: string }
  | { type: 'reorder'; id: string; index: number }
  | { type: 'update'; id: string; changes: TabChanges }
  | { type: 'close'; id: string }
  | { type: 'restore'; tabs: Tab[]; activePath: string | null }
  | { type: 'saved'; id: string; stats: PdfFileStats }
  | { type: 'replace'; id: string; pdf: OpenedPdf }

export const initialDocumentsState: DocumentsState = { tabs: [], activeId: null, ready: false }

export function createTab(pdf: OpenedPdf, restored?: SessionTab): Tab {
  return {
    ...pdf,
    id: crypto.randomUUID(),
    dirty: false,
    unavailable: false,
    error: null,
    view: {
      page: restored?.page ?? 1,
      pages: 0,
      scale: restored?.scale ?? 'page-fit',
      zoomPercent: 100,
      scrollTop: restored?.scrollTop ?? 0,
      rotation: 0,
      twoPageView: false,
      canAnnotate: false,
      signed: false
    }
  }
}

export function documentsReducer(state: DocumentsState, action: DocumentsAction): DocumentsState {
  switch (action.type) {
    case 'recover': {
      const tabs = [...state.tabs]
      for (const recovered of action.tabs) {
        const index = tabs.findIndex((tab) => tab.path === recovered.path)
        if (index === -1) tabs.push(recovered)
        else tabs[index] = { ...recovered, id: tabs[index].id, view: tabs[index].view }
      }
      return {
        ...state,
        tabs,
        activeId: tabs.find((tab) => tab.path === action.tabs[0]?.path)?.id ?? state.activeId
      }
    }
    case 'open': {
      const tabs = [...state.tabs]
      let activeId = state.activeId
      for (const tab of action.tabs) {
        const existing = tabs.find((candidate) => candidate.path === tab.path)
        if (!existing) tabs.push(tab)
        activeId = existing?.id ?? tab.id
      }
      return { ...state, tabs, activeId }
    }
    case 'select':
      return state.tabs.some((tab) => tab.id === action.id)
        ? { ...state, activeId: action.id }
        : state
    case 'reorder': {
      const from = state.tabs.findIndex((tab) => tab.id === action.id)
      if (
        from === -1 ||
        from === action.index ||
        action.index < 0 ||
        action.index >= state.tabs.length
      )
        return state
      const tabs = [...state.tabs]
      const [tab] = tabs.splice(from, 1)
      tabs.splice(action.index, 0, tab)
      return { ...state, tabs }
    }
    case 'update':
      return {
        ...state,
        tabs: state.tabs.map((tab) => (tab.id === action.id ? { ...tab, ...action.changes } : tab))
      }
    case 'close': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id)
      if (index === -1) return state
      const tabs = state.tabs.filter((tab) => tab.id !== action.id)
      const activeId =
        state.activeId === action.id
          ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
          : state.activeId
      return { ...state, tabs, activeId }
    }
    case 'restore': {
      // Documents opened during startup take precedence over the saved session.
      const tabs = [
        ...action.tabs.filter((tab) => !state.tabs.some((open) => open.path === tab.path)),
        ...state.tabs
      ]
      const activeId =
        state.activeId ??
        tabs.find((tab) => tab.path === action.activePath)?.id ??
        tabs[0]?.id ??
        null
      return { tabs, activeId, ready: true }
    }
    case 'saved':
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.id ? { ...tab, ...action.stats, dirty: false } : tab
        )
      }
    case 'replace':
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.id
            ? {
                ...tab,
                ...action.pdf,
                id: tab.id,
                view: tab.view,
                dirty: false,
                unavailable: false,
                error: null
              }
            : tab
        )
      }
  }
}
