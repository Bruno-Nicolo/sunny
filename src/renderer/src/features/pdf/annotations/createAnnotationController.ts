import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  RenderingStates,
  type EventBus,
  type PDFViewer
} from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import { AnnotationLayer } from './annotationLayer'
import { AnnotationModel, type Annotation } from './model'
import { writeAnnotations } from './pdfAnnotationWriter'
import { readPageAnnotations } from './pdfAnnotationReader'
import { normalizedRect } from './geometry'
import { layoutText } from './text/textLayout'
import { validateImage } from './images/imageFiles'
import type { TextEditorSettings } from './text/types'
import type { AnnotationInsertionPoint, AnnotationOptions } from './types'
import type { PageAnnotations } from './pageAnnotations'

type Options = {
  eventBus: EventBus
  viewer: PDFViewer
  container: HTMLDivElement
  signal: AbortSignal
  initialOptions: AnnotationOptions
  onDirtyChange(dirty: boolean): void
  onTextEditorChange(settings: TextEditorSettings | null): void
  onError(message: string): void
}

type AnnotationController = {
  highlightSelection(): void
  setDocument(document: PDFDocumentProxy): void
  initialize(canAnnotate: boolean): void
  setOptions(options: AnnotationOptions): void
  setHighlightColor(color: string): void
  addImage(file: File, point?: AnnotationInsertionPoint): Promise<void>
  addText(text: string, point?: AnnotationInsertionPoint): Promise<void>
  commit(): void
  commitDraft(): void
  undo(): void
  redo(): void
  readonly pageAnnotations: PageAnnotations
  readonly hash: string
  save(): Promise<Uint8Array>
}

// The app owns annotation state and interaction; PDF.js owns pages and incremental PDF output.
export function createAnnotationController({
  eventBus,
  viewer,
  container,
  signal,
  initialOptions,
  onDirtyChange,
  onTextEditorChange,
  onError
}: Options): AnnotationController {
  let options = initialOptions
  let document: PDFDocumentProxy | null = null
  let formRevision = 0
  let resolveInitialized!: () => void
  const initialized = new Promise<void>((resolve) => {
    resolveInitialized = resolve
  })
  let ready = false
  let permitted = false
  let selected: string | null = null
  let historyAction = false
  let pointerSelection = false
  let selectionFrame: number | null = null
  const defaults = { color: '#000000', size: 8 }
  const pages = new Map<number, AnnotationLayer>()
  const imports = new Map<number, Promise<void>>()
  const canEdit = (): boolean => ready && permitted && options.active && !signal.aborted
  const thumbnailListeners = new Map<number, Set<(baseChanged: boolean) => void>>()
  const model = new AnnotationModel((changed, key, pageIndex) => {
    if (signal.aborted) return
    if (selected && !model.records.has(selected)) selected = null
    if (historyAction && model.records.has(key)) selected = key
    render(pageIndex)
    refreshText()
    for (const listener of [...(thumbnailListeners.get(pageIndex) ?? [])]) listener(false)
    if (changed) onDirtyChange(true)
  })

  function render(pageIndex?: number): void {
    if (pageIndex !== undefined) pages.get(pageIndex)?.render(options.annotationTool)
    else for (const layer of pages.values()) layer.render(options.annotationTool)
  }

  function refreshText(): void {
    const record = selected ? model.records.get(selected) : undefined
    const text = record?.kind === 'text' ? record : undefined
    const set = (field: 'color' | 'fontSize', value: string | number): void => {
      if (!canEdit()) return
      const current = selected ? model.records.get(selected) : undefined
      if (current?.kind === 'text') {
        if (
          current[field] === value ||
          (field === 'color' && current.color.toLowerCase() === String(value).toLowerCase())
        )
          return
        const next = { ...current, [field]: value }
        model.change(current, field === 'fontSize' ? layoutText(next, next.text ?? '') : next)
      } else {
        if (field === 'color') defaults.color = value as string
        else defaults.size = value as number
        refreshText()
      }
    }
    onTextEditorChange({
      element: text ? (pages.get(text.pageIndex)?.editors.get(text.key) ?? null) : null,
      color: text?.color ?? defaults.color,
      size: text?.fontSize ?? defaults.size,
      setColor: (color) => set('color', color),
      setSize: (size) => set('fontSize', size)
    })
  }

  function commit(): void {
    for (const record of [...model.records.values()]) {
      if (
        record.kind === 'text' &&
        !record.text?.trim() &&
        model.originals.get(record.key) !== record
      ) {
        model.change(record, undefined, true)
      }
    }
    model.commit()
  }

  function select(key: string | null, editing = false): void {
    if (key !== selected) {
      commit()
      for (const layer of pages.values()) layer.stopEditing()
    }
    selected = key
    render()
    if (editing && key) {
      const record = model.records.get(key)
      if (record) pages.get(record.pageIndex)?.edit(key)
    }
    refreshText()
  }

  function updateText(record: Annotation, text: string): void {
    if (record.text !== text) model.change(record, layoutText(record, text), true)
  }

  function insertionPoint(point?: AnnotationInsertionPoint): {
    pageIndex: number
    left: number
    top: number
  } {
    if (point) {
      const page = window.document
        .elementFromPoint(point.clientX, point.clientY)
        ?.closest<HTMLElement>('.page')
      if (page && container.contains(page)) {
        const bounds = page.getBoundingClientRect()
        return {
          pageIndex: Number(page.dataset.pageNumber) - 1,
          left: point.clientX - bounds.left,
          top: point.clientY - bounds.top
        }
      }
    }
    const pageIndex = viewer.currentPageNumber - 1
    const { width, height } = viewer.getPageView(pageIndex).viewport
    return { pageIndex, left: width / 2, top: height / 2 }
  }

  function createText(pageIndex: number, left: number, top: number, text = ''): void {
    const viewport = viewer.getPageView(pageIndex).viewport
    // Pasted blocks use their center; empty editors anchor the first line's caret.
    const [x, y] = viewport.convertToPdfPoint(
      text ? left : left - 2 * viewport.scale,
      text ? top : top - (2 + (defaults.size * 1.35) / 2) * viewport.scale
    )
    const record = layoutText(
      {
        key: crypto.randomUUID(),
        kind: 'text',
        pageIndex,
        rect: [x, y, x, y],
        rotation: viewport.rotation,
        color: defaults.color,
        fontSize: defaults.size
      },
      text
    )
    if (text) {
      const halfWidth = (record.rect[2] - record.rect[0]) / 2
      const halfHeight = (record.rect[3] - record.rect[1]) / 2
      record.rect = [x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight]
    }
    select(null)
    selected = record.key
    model.change(undefined, record, true)
    const layer = pages.get(pageIndex)
    if (text) layer?.editors.get(record.key)?.focus({ preventScroll: true })
    else layer?.edit(record.key)
    refreshText()
  }

  async function importPage(pageIndex: number): Promise<void> {
    if (!document || !permitted) return
    const records = await readPageAnnotations(await document.getPage(pageIndex + 1))
    if (signal.aborted) {
      for (const record of records)
        if (record.image) record.image.canvas.width = record.image.canvas.height = 0
      return
    }
    for (const record of records) {
      model.import(record)
    }
    if (!records.length) return
    document.annotationStorage.setOverlayAnnotationIds(
      pageIndex,
      records.map((record) => record.originalId!)
    )
    for (const listener of [...(thumbnailListeners.get(pageIndex) ?? [])]) listener(true)
  }

  function attachPages(): void {
    for (let index = 0; index < viewer.pagesCount; index++) {
      const page = viewer.getPageView(index)
      const reset = page.reset.bind(page)
      page.reset = (resetOptions): void => {
        const layer = pages.get(index)
        const focused = window.document.activeElement as HTMLElement | null
        const retainFocus = !!focused && !!layer?.element.contains(focused)
        const selection = retainFocus ? window.getSelection() : null
        const anchor = selection?.anchorNode,
          anchorOffset = selection?.anchorOffset ?? 0
        const focus = selection?.focusNode,
          focusOffset = selection?.focusOffset ?? 0
        reset(resetOptions)
        if (!layer || signal.aborted) return
        layer.render(options.annotationTool)
        if (retainFocus && canEdit()) {
          focused?.focus({ preventScroll: true })
          if (anchor?.isConnected && focus?.isConnected)
            selection?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset)
        }
      }
      let generation = 0
      const destroy = page.destroy.bind(page)
      page.destroy = (): void => {
        generation++
        pages.get(index)?.dispose()
        pages.delete(index)
        destroy()
      }
      const draw = page.draw.bind(page)
      let pending: Promise<void> | null = null
      page.draw = (): Promise<void> => {
        if (pending) return pending
        const drawGeneration = generation
        let prepare = imports.get(index)
        if (!prepare) {
          prepare = importPage(index)
          imports.set(index, prepare)
          void prepare.catch(() => imports.delete(index))
        }
        pending = prepare
          .then(async () => {
            if (signal.aborted || generation !== drawGeneration) return
            await draw()
            if (
              signal.aborted ||
              generation !== drawGeneration ||
              page.renderingState !== RenderingStates.FINISHED
            )
              return
            let layer = pages.get(index)
            if (!layer) {
              layer = new AnnotationLayer({
                page,
                model,
                signal,
                canEdit,
                selected: () => selected,
                select,
                updateText,
                createText: (left, top) => createText(index, left, top)
              })
              pages.set(index, layer)
            }
            layer.render(options.annotationTool)
            refreshText()
          })
          .catch((error: unknown) => {
            if (!signal.aborted)
              onError(error instanceof Error ? error.message : 'Annotations could not be loaded.')
            throw error
          })
          .finally(() => {
            pending = null
          })
        return pending
      }
    }
  }

  function highlightSelection(): void {
    if (!canEdit() || pointerSelection) return
    const selection = window.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed) return
    if (!(
      selection.anchorNode?.parentElement?.closest('.textLayer') &&
      container.contains(selection.anchorNode)
    ))
      return
    const range = selection.getRangeAt(0)
    const rectangles = [...range.getClientRects()].filter(
      (rect) => rect.width > 0 && rect.height > 0
    )
    const created: Annotation[] = []
    for (const [pageIndex, layer] of pages) {
      const page = viewer.getPageView(pageIndex)
      const bounds = page.div.getBoundingClientRect()
      const quads: number[] = []
      const seen = new Set<string>()
      for (const rect of rectangles) {
        if (
          rect.bottom <= bounds.top ||
          rect.top >= bounds.bottom ||
          rect.right <= bounds.left ||
          rect.left >= bounds.right
        )
          continue
        const key = `${rect.left}:${rect.top}:${rect.width}:${rect.height}`
        if (seen.has(key)) continue
        seen.add(key)
        for (const [x, y] of [
          [rect.left, rect.top],
          [rect.right, rect.top],
          [rect.left, rect.bottom],
          [rect.right, rect.bottom]
        ]) {
          quads.push(...layer.point(x, y))
        }
      }
      if (!quads.length) continue
      const xs = quads.filter((_, index) => index % 2 === 0),
        ys = quads.filter((_, index) => index % 2 === 1)
      created.push({
        key: crypto.randomUUID(),
        kind: 'highlight',
        pageIndex,
        rotation: 0,
        color: options.highlightColor,
        opacity: 0.9,
        quads,
        rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
      })
    }
    if (!created.length) return
    select(null)
    for (const record of created) model.change(undefined, record)
    select(created.at(-1)!.key)
    selection.removeAllRanges()
  }

  window.document.addEventListener(
    'selectionchange',
    () => {
      if (selectionFrame !== null) return
      selectionFrame = requestAnimationFrame(() => {
        selectionFrame = null
        if (options.annotationTool === 'highlight') highlightSelection()
      })
    },
    { signal }
  )
  container.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as Element
      if (
        canEdit() &&
        options.annotationTool === 'highlight' &&
        event.button === 0 &&
        !target.closest('.lepisAnnotationLayer, .annotationLayer, .textLayer span')
      ) {
        const pageElement = target.closest<HTMLElement>('.page')
        const pageIndex = Number(pageElement?.dataset.pageNumber) - 1
        const layer = pages.get(pageIndex)
        if (layer) {
          layer.startHighlight(event, options.highlightColor)
          return
        }
      }
      if ((event.target as Element).closest('.textLayer')) pointerSelection = true
      if (!(event.target as Element).closest('.lepisAnnotationLayer')) select(null)
    },
    { signal }
  )
  window.addEventListener(
    'pointerup',
    () => {
      pointerSelection = false
      if (options.annotationTool === 'highlight') highlightSelection()
    },
    { signal }
  )
  for (const event of ['input', 'change'])
    container.addEventListener(
      event,
      (event) => {
        if ((event.target as Element).closest('.annotationLayer') && !signal.aborted) {
          formRevision++
          onDirtyChange(true)
        }
      },
      { signal }
    )
  container.addEventListener(
    'copy',
    (event) => {
      if (!canEdit() || !selected || !(event.target instanceof HTMLElement)) return
      if (event.target.isContentEditable || event.target.closest('input, textarea, select')) return
      const record = model.records.get(selected)
      if (!record || record.kind === 'highlight') return
      if (record.kind === 'text') {
        if (!event.clipboardData) return
        event.clipboardData.setData('text/plain', record.text ?? '')
      } else if (record.image) {
        const { canvas } = record.image
        const png = new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob)
            else reject(new Error('The image could not be copied.'))
          }, 'image/png')
        })
        void navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).catch((error) => {
          if (!signal.aborted)
            onError(error instanceof Error ? error.message : 'The image could not be copied.')
        })
      } else return
      event.preventDefault()
      event.stopPropagation()
    },
    { signal }
  )
  container.addEventListener(
    'keydown',
    (event) => {
      if (!canEdit()) return
      const target = event.target as HTMLElement
      if (event.key === 'Escape') {
        event.preventDefault()
        select(null)
        container.focus()
        return
      }
      if (!selected || target.isContentEditable || !['Delete', 'Backspace'].includes(event.key))
        return
      event.preventDefault()
      const record = model.records.get(selected)
      if (record) model.change(record, undefined)
    },
    { signal }
  )
  eventBus.on(
    'pagerendered',
    ({ pageNumber }: { pageNumber: number }) => {
      pages.get(pageNumber - 1)?.render(options.annotationTool)
    },
    { signal }
  )
  for (const event of ['scalechanging', 'rotationchanging'])
    eventBus.on(event, () => render(), { signal })
  signal.addEventListener(
    'abort',
    () => {
      if (selectionFrame !== null) cancelAnimationFrame(selectionFrame)
      resolveInitialized()
      model.dispose()
      pages.clear()
      imports.clear()
      thumbnailListeners.clear()
      document = null
    },
    { once: true }
  )

  function applyHistory(action: 'undo' | 'redo'): void {
    if (!canEdit()) return
    historyAction = true
    try {
      model[action]()
    } finally {
      historyAction = false
    }
    refreshText()
  }

  return {
    highlightSelection,
    pageAnnotations: {
      // Wait for an existing editor import; thumbnails alone keep originals on the PDF rendering path.
      async prepare(pageIndex) {
        await initialized
        await imports.get(pageIndex)
      },
      forPage: (pageIndex) => model.forPage(pageIndex),
      subscribe(pageIndex, listener) {
        let listeners = thumbnailListeners.get(pageIndex)
        if (!listeners) thumbnailListeners.set(pageIndex, (listeners = new Set()))
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          if (!listeners.size) thumbnailListeners.delete(pageIndex)
        }
      }
    },
    setDocument(value: PDFDocumentProxy): void {
      document = value
    },
    initialize(canAnnotate: boolean): void {
      permitted = canAnnotate
      ready = true
      resolveInitialized()
      attachPages()
      refreshText()
    },
    setOptions(next: AnnotationOptions): void {
      const lostFocus = options.active && !next.active
      const toolChanged = options.annotationTool !== next.annotationTool
      options = next
      if (lostFocus || toolChanged) {
        commit()
        for (const layer of pages.values()) layer.stopEditing()
      }
      render()
      refreshText()
    },
    setHighlightColor(color: string): void {
      options = { ...options, highlightColor: color }
      if (!canEdit() || !selected) return
      const record = model.records.get(selected)
      if (record?.kind === 'highlight' && record.color.toLowerCase() !== color.toLowerCase()) {
        model.change(record, { ...record, color })
      }
    },
    async addText(text: string, point?: AnnotationInsertionPoint): Promise<void> {
      if (!canEdit()) throw new Error('This PDF is not ready for editing.')
      if (!text.trim()) return
      const { pageIndex, left, top } = insertionPoint(point)
      const pending = imports.get(pageIndex)
      if (pending) await pending
      if (!canEdit()) return
      createText(pageIndex, left, top, text.replace(/\r\n?/g, '\n'))
    },
    async addImage(file: File, point?: AnnotationInsertionPoint): Promise<void> {
      if (!canEdit()) throw new Error('This PDF is not ready for editing.')
      const position = insertionPoint(point)
      const { pageIndex } = position
      await validateImage(file)
      const bitmap = await createImageBitmap(file)
      if (!canEdit()) {
        bitmap.close()
        return
      }
      const canvas = window.document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      bitmap.close()
      const pending = imports.get(pageIndex)
      if (pending) await pending
      if (!canEdit()) {
        canvas.width = canvas.height = 0
        return
      }
      const page = viewer.getPageView(pageIndex)
      const viewport = page.viewport
      const fit = Math.min(
        1,
        viewport.width / viewport.scale / 2 / canvas.width,
        viewport.height / viewport.scale / 2 / canvas.height
      )
      const width = canvas.width * fit
      const height = canvas.height * fit
      const left = position.left - (width * viewport.scale) / 2
      const top = position.top - (height * viewport.scale) / 2
      const record: Annotation = {
        key: crypto.randomUUID(),
        kind: 'image',
        pageIndex,
        rect: normalizedRect(
          viewport.convertToPdfPoint(left, top),
          viewport.convertToPdfPoint(left + width * viewport.scale, top + height * viewport.scale)
        ),
        rotation: viewport.rotation,
        color: '#000000',
        image: { id: crypto.randomUUID(), canvas, rotation: viewport.rotation }
      }
      select(null)
      model.change(undefined, record)
      select(record.key)
    },
    commit,
    commitDraft(): void {
      model.commit()
    },
    undo: () => applyHistory('undo'),
    redo: () => applyHistory('redo'),
    get hash(): string {
      return `${model.hash}:${formRevision}`
    },
    async save(): Promise<Uint8Array> {
      if (!document || signal.aborted) throw new Error('The PDF is not ready.')
      return writeAnnotations(document, model)
    }
  }
}
