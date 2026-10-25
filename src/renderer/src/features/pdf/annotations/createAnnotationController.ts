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
import { textRect, normalizedRect } from './geometry'
import { validateImage } from './images/imageFiles'
import type { TextEditorSettings } from './text/types'
import type { AnnotationOptions } from './types'

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
  setDocument(document: PDFDocumentProxy): void
  initialize(canAnnotate: boolean): void
  setOptions(options: AnnotationOptions): void
  setHighlightColor(color: string): void
  addImage(file: File): Promise<void>
  addText(text: string): Promise<void>
  commit(): void
  commitDraft(): void
  undo(): void
  redo(): void
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
  let ready = false
  let permitted = false
  let selected: string | null = null
  let historyAction = false
  let pointerSelection = false
  let selectionFrame: number | null = null
  const defaults = { color: '#000000', size: 8 }
  let textContext: CanvasRenderingContext2D | null = null
  const pages = new Map<number, AnnotationLayer>()
  const imports = new Map<number, Promise<void>>()
  const canEdit = (): boolean => ready && permitted && options.active && !signal.aborted
  const model = new AnnotationModel((changed, key) => {
    if (signal.aborted) return
    if (selected && !model.records.has(selected)) selected = null
    if (historyAction && key && model.records.has(key)) selected = key
    render(key)
    refreshText()
    if (changed) onDirtyChange(true)
  })

  function render(key?: string): void {
    const pageIndex = key
      ? (model.records.get(key) ?? model.originals.get(key))?.pageIndex
      : undefined
    for (const [index, layer] of pages) {
      if (pageIndex === undefined || pageIndex === index) layer.render(options.annotationTool)
    }
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

  function layoutText(record: Annotation, text: string): Annotation {
    const context = (textContext ??= window.document.createElement('canvas').getContext('2d')!)
    context.font = `${record.fontSize}px Helvetica, Arial, sans-serif`
    const lines = text.split('\n')
    const width = Math.max(16, ...lines.map((line) => context.measureText(line).width)) + 4
    const height = Math.max(1, lines.length) * record.fontSize! * 1.35 + 4
    return { ...record, text, rect: textRect(record, width, height) }
  }

  function updateText(record: Annotation, text: string): void {
    if (record.text !== text) model.change(record, layoutText(record, text), true)
  }

  function createText(pageIndex: number, x: number, y: number, text = ''): void {
    const record = layoutText(
      {
        key: crypto.randomUUID(),
        kind: 'text',
        pageIndex,
        rect: [x, y, x, y],
        rotation: viewer.getPageView(pageIndex).viewport.rotation,
        color: defaults.color,
        fontSize: defaults.size
      },
      text
    )
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
    document.annotationStorage.setOverlayAnnotationIds(
      pageIndex,
      records.map((record) => record.originalId!)
    )
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
        const prepare = imports.get(index) ?? importPage(index)
        imports.set(index, prepare)
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
                createText: (x, y) => createText(index, x, y)
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
    if (!canEdit() || options.annotationTool !== 'highlight' || pointerSelection) return
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
        highlightSelection()
      })
    },
    { signal }
  )
  container.addEventListener(
    'pointerdown',
    (event) => {
      if ((event.target as Element).closest('.textLayer')) pointerSelection = true
      if (!(event.target as Element).closest('.lepisAnnotationLayer')) select(null)
    },
    { signal }
  )
  window.addEventListener(
    'pointerup',
    () => {
      pointerSelection = false
      highlightSelection()
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
      model.dispose()
      pages.clear()
      imports.clear()
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
    setDocument(value: PDFDocumentProxy): void {
      document = value
    },
    initialize(canAnnotate: boolean): void {
      permitted = canAnnotate
      ready = true
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
    async addText(text: string): Promise<void> {
      if (!canEdit()) throw new Error('This PDF is not ready for editing.')
      if (!text.trim()) return
      const pageIndex = viewer.currentPageNumber - 1
      const pending = imports.get(pageIndex)
      if (pending) await pending
      if (!canEdit()) return
      const viewport = viewer.getPageView(pageIndex).viewport
      const [x, y] = viewport.convertToPdfPoint(viewport.width / 4, viewport.height / 4)
      createText(pageIndex, x, y, text.replace(/\r\n?/g, '\n'))
    },
    async addImage(file: File): Promise<void> {
      if (!canEdit()) throw new Error('This PDF is not ready for editing.')
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
      const pageIndex = viewer.currentPageNumber - 1
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
      const left = (viewport.width - width * viewport.scale) / 2
      const top = (viewport.height - height * viewport.scale) / 2
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
