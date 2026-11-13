import {
  forwardRef,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel
} from '@/components/ui/alert-dialog'
import type { PdfDocumentViewProps } from './types'
import type { PageAnnotations } from './annotations/pageAnnotations'
import type { ThumbnailQueue } from './PageThumbnail'
import { PdfPageGrid } from './PdfPageGrid'
import { OutlineItems, type Outline } from './PdfOutline'
import { retainedPage } from './pageOperations'
import { createPageDraft, pageDraftReducer } from './pageDraft'
import { PdfNavigationHeader } from './PdfNavigationHeader'

export type NavigationHandle = {
  confirmLeave(): Promise<boolean>
  prepareChanges(): Promise<{ data: Uint8Array; page: number } | null>
}
type Props = {
  open: boolean
  onOpenChange(open: boolean): void
  document: PDFDocumentProxy
  annotations: PageAnnotations
  tab: PdfDocumentViewProps['navigationTab']
  onTabChange: PdfDocumentViewProps['onNavigationTabChange']
  page: number
  onPage(page: number): void
  canReorder: boolean
  onExtractPages(order: number[]): Promise<Uint8Array>
  onSavePages: PdfDocumentViewProps['onSavePages']
  onExportPages: PdfDocumentViewProps['onExportPages']
  onPageDraftChange: PdfDocumentViewProps['onPageDraftChange']
  onReleasePage(page: PDFPageProxy): void
  onDestination(destination: string | unknown[]): Promise<void>
  onError(message: string): void
}
type LeaveRequest = { finish(saved?: boolean): void; cancel?(): void; page?: number }

export const PdfNavigationDialog = forwardRef<NavigationHandle, Props>(function PdfNavigationDialog(
  {
    open,
    onOpenChange,
    document,
    annotations,
    tab,
    onTabChange,
    page,
    onPage,
    onExtractPages,
    onSavePages,
    onExportPages,
    onPageDraftChange,
    canReorder,
    onReleasePage,
    onDestination,
    onError
  },
  ref
) {
  const [{ order, selected, selecting }, dispatch] = useReducer(
    pageDraftReducer,
    document.numPages,
    createPageDraft
  )
  const allSelected = selected.size === order.length
  const selectedPageLabel = selected.size === 1 ? 'page' : 'pages'
  const reorderPages = useCallback(
    (order: number[]): void => dispatch({ type: 'reorder', order }),
    []
  )
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [confirmation, setConfirmation] = useState<'delete' | 'reset' | null>(null)
  const [leaving, setLeaving] = useState(false)
  const leaveRef = useRef<LeaveRequest | null>(null)
  const [error, setError] = useState('')
  const dirty = useMemo(
    () => order.length !== document.numPages || order.some((original, index) => original !== index),
    [order, document.numPages]
  )
  const queue = useRef(Promise.resolve())
  const enqueue = useCallback<ThumbnailQueue>((render) => {
    const current = queue.current.then(render)
    queue.current = current.catch(() => {})
    return current
  }, [])
  const reportDraftChange = useEffectEvent(onPageDraftChange)
  useEffect(() => {
    reportDraftChange(dirty)
  }, [dirty])
  useEffect(
    () => () => {
      reportDraftChange(false)
      leaveRef.current?.cancel?.()
    },
    []
  )

  const reset = (selectingMode = selecting): void => {
    dispatch({ type: 'reset', count: document.numPages, selecting: selectingMode })
    setError('')
  }
  const requestLeave = useCallback(
    (request: LeaveRequest): void => {
      if (busyRef.current) {
        request.cancel?.()
        return
      }
      if (!dirty) {
        request.finish()
        return
      }
      leaveRef.current?.cancel?.()
      leaveRef.current = request
      setLeaving(true)
    },
    [dirty]
  )
  const takeLeaveRequest = (): LeaveRequest | null => {
    const request = leaveRef.current
    leaveRef.current = null
    setLeaving(false)
    return request
  }
  const cancelLeave = (): void => {
    takeLeaveRequest()?.cancel?.()
  }
  useImperativeHandle(ref, () => ({
    prepareChanges: async () =>
      dirty ? { data: await onExtractPages(order), page: retainedPage(order, page) } : null,
    confirmLeave: () =>
      new Promise<boolean>((resolve) =>
        requestLeave({
          finish: () => resolve(true),
          cancel: () => resolve(false)
        })
      )
  }))

  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The page operation failed.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const save = (): void => {
    void run(async () => {
      const request = leaveRef.current
      const data = await onExtractPages(order)
      const saved = await onSavePages(data, retainedPage(order, request?.page ?? page), () => {
        takeLeaveRequest()?.finish(true)
      })
      if (!saved) setError('Changes were not saved. Your page draft is still available.')
    })
  }
  const navigateToPage = useCallback(
    (original: number): void => {
      requestLeave({
        page: original,
        finish: (saved) => {
          // The saved replacement's initial position is supplied to onSavePages.
          if (!saved) onPage(original)
          onOpenChange(false)
        }
      })
    },
    [requestLeave, onPage, onOpenChange]
  )
  const selectPage = useCallback(
    (number: number, range: boolean): void => {
      if (selecting) dispatch({ type: 'select', page: number - 1, range })
      else navigateToPage(number)
    },
    [selecting, navigateToPage]
  )
  const [outline, setOutline] = useState<Outline | 'error' | null>(null)
  useEffect(() => {
    if (!open || tab !== 'outline' || outline !== null) return
    let cancelled = false
    void document
      .getOutline()
      .then((items) => {
        if (!cancelled) setOutline(items ?? [])
      })
      .catch(() => {
        if (!cancelled) setOutline('error')
      })
    return () => {
      cancelled = true
    }
  }, [document, open, tab, outline])

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (value) onOpenChange(true)
          else
            requestLeave({
              finish: () => {
                reset(false)
                onOpenChange(false)
              }
            })
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          data-page-selection={selecting && tab === 'pages'}
          className="flex h-[min(85vh,820px)] flex-col overflow-hidden sm:max-w-3xl"
          onKeyDownCapture={(event) => {
            if (
              event.key.toLowerCase() === 'a' &&
              (event.metaKey || event.ctrlKey) &&
              selecting &&
              tab === 'pages' &&
              !busy &&
              !(event.target instanceof HTMLInputElement)
            ) {
              event.preventDefault()
              event.stopPropagation()
              dispatch({ type: 'select-all' })
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            window.document
              .querySelector<HTMLButtonElement>('[aria-label="Toggle PDF navigation"]')
              ?.focus()
          }}
        >
          <Tabs
            value={tab}
            onValueChange={(value) => {
              if (!busy && (value === 'pages' || value === 'outline')) onTabChange(value)
            }}
            className="min-h-0 flex-1 gap-4"
          >
            <PdfNavigationHeader
              tab={tab}
              pageCount={order.length}
              selectedCount={selected.size}
              selecting={selecting}
              busy={busy}
              canReorder={canReorder}
              onToggleSelection={() => dispatch({ type: 'toggle-selection' })}
              onToggleAll={() => dispatch({ type: allSelected ? 'deselect-all' : 'select-all' })}
              onExport={() =>
                void run(async () => {
                  const data = await onExtractPages(order.filter((id) => selected.has(id)))
                  await onExportPages(data)
                })
              }
              onDelete={() => setConfirmation('delete')}
            />
            <TabsContent value="pages" className="flex min-h-0 flex-col gap-3">
              <div className="min-h-0 flex-1 overflow-y-auto" data-page-scroll>
                <PdfPageGrid
                  document={document}
                  annotations={annotations}
                  order={order}
                  selected={selected}
                  selecting={selecting}
                  page={page}
                  busy={busy}
                  canReorder={canReorder}
                  open={open}
                  onOrderChange={reorderPages}
                  onPage={selectPage}
                  onReleasePage={onReleasePage}
                  enqueue={enqueue}
                />
              </div>
            </TabsContent>
            <TabsContent value="outline" className="min-h-0 overflow-y-auto px-3 pb-3">
              {outline === 'error' ? (
                <p role="status">The outline could not be loaded.</p>
              ) : outline === null ? (
                <p role="status">Loading outline…</p>
              ) : !outline.length ? (
                <p role="status">This PDF has no outline.</p>
              ) : (
                <OutlineItems
                  document={document}
                  items={outline}
                  onError={onError}
                  onDestination={async (destination) => {
                    if (!dirty) {
                      await onDestination(destination)
                      onOpenChange(false)
                      return
                    }
                    const target =
                      typeof destination === 'string'
                        ? await document.getDestination(destination)
                        : destination
                    if (!target) throw new Error('The outline destination is missing.')
                    const index =
                      typeof target[0] === 'number'
                        ? target[0]
                        : await document.getPageIndex(target[0] as { num: number; gen: number })
                    navigateToPage(index + 1)
                  }}
                />
              )}
            </TabsContent>
          </Tabs>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {dirty && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              {busy && <span className="mr-auto text-xs text-muted-foreground">Working…</span>}
              <Button variant="outline" disabled={busy} onClick={() => setConfirmation('reset')}>
                Discard page changes
              </Button>
              <Button disabled={busy || !canReorder} onClick={save}>
                Save changes
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(value) => {
          if (!value) setConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === 'delete'
                ? `Delete ${selected.size} ${selectedPageLabel}?`
                : 'Discard page changes?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === 'delete'
                ? `The selected ${selectedPageLabel} will be removed when you save changes. Page changes cannot be undone after saving.`
                : 'Restore the page order and deleted pages from before this draft. Your annotations will be kept.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmation === 'delete') {
                  dispatch({ type: 'delete-selected' })
                } else reset()
                setConfirmation(null)
              }}
            >
              {confirmation === 'delete' ? `Delete ${selectedPageLabel}` : 'Discard page changes'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={leaving}
        onOpenChange={(value) => {
          if (!value && !busy) cancelLeave()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved page changes</AlertDialogTitle>
            <AlertDialogDescription>
              Save the new page order and deletions to the PDF, or discard them. Saving also
              includes your current annotations and clears their previous undo history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <Button variant="outline" disabled={busy} onClick={cancelLeave}>
              Continue editing
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                reset()
                takeLeaveRequest()?.finish()
              }}
            >
              Discard
            </Button>
            <Button disabled={busy} onClick={save}>
              Save changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
})
