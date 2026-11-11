import type { OpenedPdf } from '../../../../shared/contracts'
import type { ViewerSnapshot } from '@/features/pdf/types'

export type Tab = OpenedPdf & {
  id: string
  pageDraft: boolean
  dirty: boolean
  unavailable: boolean
  error: string | null
  view: ViewerSnapshot
}

export type CloseRequest = { type: 'tab'; id: string } | { type: 'window' } | null
