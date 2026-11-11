import { initialPageOrder } from './pageOperations'

export type PageDraft = {
  order: number[]
  selected: ReadonlySet<number>
  selecting: boolean
  anchor: number | null
}
export type PageDraftAction =
  | { type: 'toggle-selection' }
  | { type: 'select'; page: number; range: boolean }
  | { type: 'select-all' }
  | { type: 'deselect-all' }
  | { type: 'reorder'; order: number[] }
  | { type: 'delete-selected' }
  | { type: 'reset'; count: number; selecting: boolean }

export function createPageDraft(count: number): PageDraft {
  return { order: initialPageOrder(count), selected: new Set(), selecting: false, anchor: null }
}

/** Keep the page order, selection and range anchor consistent across each user operation. */
export function pageDraftReducer(state: PageDraft, action: PageDraftAction): PageDraft {
  switch (action.type) {
    case 'toggle-selection':
      return { ...state, selecting: !state.selecting, selected: new Set(), anchor: null }
    case 'select-all':
      return { ...state, selected: new Set(state.order) }
    case 'deselect-all':
      return { ...state, selected: new Set(), anchor: null }
    case 'select': {
      const selected = new Set(state.selected)
      const from = state.anchor === null ? -1 : state.order.indexOf(state.anchor)
      if (action.range && from >= 0) {
        const to = state.order.indexOf(action.page)
        for (const page of state.order.slice(Math.min(from, to), Math.max(from, to) + 1))
          selected.add(page)
      } else if (selected.has(action.page)) selected.delete(action.page)
      else selected.add(action.page)
      return {
        ...state,
        selected,
        anchor: !action.range || state.anchor === null ? action.page : state.anchor
      }
    }
    case 'reorder':
      return action.order.length === state.order.length &&
        action.order.every((page, index) => page === state.order[index])
        ? state
        : { ...state, order: action.order }
    case 'delete-selected': {
      const order = state.order.filter((page) => !state.selected.has(page))
      return order.length && order.length < state.order.length
        ? { ...state, order, selected: new Set(), anchor: null }
        : state
    }
    case 'reset':
      return { ...createPageDraft(action.count), selecting: action.selecting }
  }
}
