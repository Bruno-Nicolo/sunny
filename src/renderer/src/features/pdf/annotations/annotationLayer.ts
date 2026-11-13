import type { PDFPageView } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import type { Annotation, AnnotationModel, PdfRect } from './model'
import type { AnnotationTool } from './types'
import { annotationOrientation, normalizedRect } from './geometry'
import { layoutText } from './text/textLayout'
import { drawHighlight } from './highlight/freehand'
import { highlightPath as viewportHighlightPath } from './highlight/geometry'

type Options = {
  page: PDFPageView
  model: AnnotationModel
  signal: AbortSignal
  canEdit(): boolean
  selected(): string | null
  select(key: string | null, editing?: boolean): void
  updateText(record: Annotation, text: string): void
  createText(left: number, top: number): void
}

export class AnnotationLayer {
  readonly element = document.createElement('div')
  readonly editors = new Map<string, HTMLDivElement>()
  private readonly background = document.createElement('div')
  private readonly highlightPaths = new Map<string, SVGPathElement>()
  private readonly highlightDrawings = new Set<SVGSVGElement>()
  private readonly lifetime = new AbortController()
  private readonly renderedRecords = new Map<string, Annotation>()
  private renderedViewport = ''
  private renderedModelHash = ''
  private lastSelected: string | null = null
  private tool: AnnotationTool = 'none'
  private editingKey: string | null = null
  private drag: AbortController | null = null
  private cancelStroke?: () => void
  private readonly editorLifetimes = new Map<string, AbortController>()

  constructor(private readonly options: Options) {
    const { page, canEdit, createText, select } = options
    const signal = AbortSignal.any([options.signal, this.lifetime.signal])
    this.element.className = 'annotationEditorLayer lepisAnnotationLayer'
    this.element.dataset.pageNumber = String(page.id)
    this.background.className = 'lepisAnnotationBackground'
    this.element.append(this.background)
    this.element.addEventListener(
      'pointerdown',
      (event) => {
        if (
          !canEdit() ||
          event.button !== 0 ||
          (event.target !== this.element && event.target !== this.background)
        )
          return
        select(null)
        if (this.tool !== 'text') return
        event.preventDefault()
        const rect = this.element.getBoundingClientRect()
        createText(event.clientX - rect.left, event.clientY - rect.top)
      },
      { signal }
    )
    signal.addEventListener(
      'abort',
      () => {
        this.cancelStroke?.()
        this.drag?.abort()
        this.element.remove()
      },
      { once: true }
    )
  }

  point(x: number, y: number): [number, number] {
    const rect = this.options.page.div.getBoundingClientRect()
    return this.options.page.viewport.convertToPdfPoint(x - rect.left, y - rect.top) as [
      number,
      number
    ]
  }

  startHighlight(event: PointerEvent, color: string): void {
    const { page, model, select } = this.options
    event.preventDefault()
    select(null)
    window.getSelection()?.removeAllRanges()
    this.cancelStroke?.()
    this.cancelStroke = drawHighlight({
      event,
      element: this.element,
      viewport: page.viewport,
      pageIndex: page.id! - 1,
      color,
      signal: AbortSignal.any([this.options.signal, this.lifetime.signal]),
      complete: (record) => {
        this.cancelStroke = undefined
        model.change(undefined, record)
        select(record.key)
      }
    })
  }

  edit(key: string): void {
    this.editingKey = key
    this.render(this.tool)
    const input = this.editors.get(key)?.querySelector<HTMLElement>('.internal')
    if (input) this.setEditing(input, true)
    input?.focus({ preventScroll: true })
  }

  stopEditing(): void {
    if (!this.editingKey) return
    const input = this.editors.get(this.editingKey)?.querySelector<HTMLElement>('.internal')
    if (input) this.setEditing(input, false)
    this.editingKey = null
  }

  private setEditing(input: HTMLElement, editing: boolean): void {
    input.contentEditable = editing ? 'plaintext-only' : 'false'
    input.parentElement!.querySelector<HTMLElement>('.resizers')!.hidden = editing
  }

  render(tool: AnnotationTool): void {
    this.tool = tool
    const { page, model, selected, canEdit } = this.options
    const editable = canEdit()
    const selection = selected()
    this.element.classList.toggle('freetextEditing', tool === 'text' && editable)
    this.element.classList.toggle('highlightEditing', tool === 'highlight' && editable)
    this.element.classList.toggle('disabled', !editable)
    const viewportKey = page.viewport.transform.join(',')
    const viewportChanged = viewportKey !== this.renderedViewport
    if (viewportChanged) {
      this.element.style.width = `${page.viewport.width}px`
      this.element.style.height = `${page.viewport.height}px`
    }
    if (viewportChanged || tool !== 'highlight' || !editable) {
      this.cancelStroke?.()
      this.cancelStroke = undefined
    }
    this.renderedViewport = viewportKey
    if (this.lastSelected !== selection) {
      if (this.lastSelected) this.editors.get(this.lastSelected)?.classList.remove('selectedEditor')
      if (selection) this.editors.get(selection)?.classList.add('selectedEditor')
      this.lastSelected = selection
    }
    if (this.element.parentNode !== page.div) page.div.append(this.element)
    const modelHash = model.hash
    if (!viewportChanged && modelHash === this.renderedModelHash) return
    this.renderedModelHash = modelHash
    for (const [key, element] of this.editors) {
      if (!model.records.has(key)) {
        element.remove()
        this.editors.delete(key)
        this.renderedRecords.delete(key)
        this.highlightPaths.get(key)?.remove()
        this.highlightPaths.delete(key)
        this.editorLifetimes.get(key)?.abort()
        this.editorLifetimes.delete(key)
      }
    }
    let highlightGroup: SVGSVGElement | null = null
    const usedGroups = new Set<SVGSVGElement>()
    for (const record of model.forPage(page.id! - 1)) {
      let editor = this.editors.get(record.key)
      if (!editor) {
        editor = this.createEditor(record)
        this.editors.set(record.key, editor)
        this.element.append(editor)
      }
      let highlightPath = this.highlightPaths.get(record.key)
      if (record.kind === 'highlight') {
        if (!highlightGroup) {
          const candidate = highlightPath?.ownerSVGElement
          highlightGroup =
            candidate && !usedGroups.has(candidate)
              ? candidate
              : document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          highlightGroup.classList.add('lepisHighlightDrawing')
          highlightGroup.setAttribute('aria-hidden', 'true')
          this.highlightDrawings.add(highlightGroup)
          if (highlightGroup.nextSibling !== editor)
            this.element.insertBefore(highlightGroup, editor)
          usedGroups.add(highlightGroup)
          if (viewportChanged || !highlightGroup.hasAttribute('viewBox'))
            highlightGroup.setAttribute(
              'viewBox',
              `0 0 ${page.viewport.width} ${page.viewport.height}`
            )
        }
        if (!highlightPath) {
          highlightPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          this.highlightPaths.set(record.key, highlightPath)
        }
        if (highlightPath.parentNode !== highlightGroup) highlightGroup.append(highlightPath)
      } else highlightGroup = null
      if (!viewportChanged && this.renderedRecords.get(record.key) === record) continue
      this.renderedRecords.set(record.key, record)
      this.position(editor, record.rect)
      editor.classList.toggle('selectedEditor', selection === record.key)
      const input = editor.querySelector<HTMLElement>('.internal')
      if (input) {
        if (input.innerText.replaceAll('\u00a0', ' ') !== record.text)
          input.innerText = record.text ?? ''
        input.style.fontSize = `${record.fontSize! * page.viewport.scale}px`
        input.style.color = record.color
        this.setEditing(input, this.editingKey === record.key && editable)
        this.orient(input, record)
      }
      if (highlightPath) {
        const path = viewportHighlightPath(record, page.viewport)
        highlightPath.setAttribute('d', path)
        highlightPath.classList.toggle('lepisFreehandStroke', !!record.strokes)
        highlightPath.style.fill = record.strokes ? 'none' : record.color
        highlightPath.style.stroke = record.strokes ? record.color : 'none'
        highlightPath.style.strokeWidth = `${(record.thickness ?? 0) * page.viewport.scale}px`
        editor.classList.toggle('freehandHighlight', !!record.strokes)
        highlightPath.style.opacity = String(record.opacity ?? 0.9)
        const contour = editor.querySelector('svg')!
        const [x1, y1, x2, y2] = this.bounds(record.rect)
        contour.setAttribute('viewBox', `${x1} ${y1} ${x2 - x1} ${y2 - y1}`)
        contour.firstElementChild!.setAttribute('d', path)
        if (record.strokes) {
          const hit = contour.firstElementChild as SVGPathElement
          hit.classList.add('lepisFreehandStroke')
          hit.style.strokeWidth = highlightPath.style.strokeWidth
        }
      }
      const canvas = editor.querySelector<HTMLCanvasElement>('canvas')
      if (canvas) this.orient(canvas, record)
      if (canvas && record.image && canvas.dataset.asset !== record.image.id) {
        canvas.width = record.image.canvas.width
        canvas.height = record.image.canvas.height
        canvas.getContext('2d')!.drawImage(record.image.canvas, 0, 0)
        canvas.dataset.asset = record.image.id
      }
    }
    for (const drawing of this.highlightDrawings) {
      if (!drawing.childElementCount) {
        drawing.remove()
        this.highlightDrawings.delete(drawing)
      }
    }
  }

  private orient(element: HTMLElement, record: Annotation): void {
    const { rotation, scale } = this.options.page.viewport
    const { width, height, x, y, angle } = annotationOrientation(record, rotation, scale)
    element.style.width = `${width}px`
    element.style.height = `${height}px`
    element.style.transformOrigin = '0 0'
    element.style.transform = `translate(${x}px, ${y}px) rotate(${angle}deg)`
  }

  dispose(): void {
    this.lifetime.abort()
    this.editors.clear()
    this.renderedRecords.clear()
    this.highlightPaths.clear()
    this.highlightDrawings.clear()
    this.editorLifetimes.clear()
  }

  private bounds(rect: PdfRect): number[] {
    const viewport = this.options.page.viewport
    const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1])
    const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3])
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
  }

  private position(element: HTMLElement, rect: PdfRect): void {
    const [x1, y1, x2, y2] = this.bounds(rect)
    Object.assign(element.style, {
      left: `${x1}px`,
      top: `${y1}px`,
      width: `${x2 - x1}px`,
      height: `${y2 - y1}px`
    })
  }

  private createEditor(record: Annotation): HTMLDivElement {
    const { model, select, canEdit, updateText } = this.options
    const lifetime = new AbortController()
    this.editorLifetimes.set(record.key, lifetime)
    const signal = AbortSignal.any([this.options.signal, this.lifetime.signal, lifetime.signal])
    const editor = document.createElement('div')
    editor.className =
      record.kind === 'text'
        ? 'freeTextEditor'
        : record.kind === 'image'
          ? 'stampEditor'
          : 'highlightEditor'
    editor.dataset.annotationKey = record.key
    editor.tabIndex = 0
    editor.setAttribute('role', 'group')
    editor.setAttribute(
      'aria-label',
      record.kind === 'text'
        ? 'Text annotation'
        : record.kind === 'image'
          ? 'Image annotation'
          : 'Highlight annotation'
    )
    if (record.kind === 'text') {
      const input = document.createElement('div')
      input.className = 'internal'
      input.spellcheck = false
      editor.append(input)
      input.addEventListener(
        'input',
        () => {
          const current = model.records.get(record.key)
          if (canEdit() && current) updateText(current, input.innerText.replaceAll('\u00a0', ' '))
        },
        { signal }
      )
      editor.addEventListener(
        'dblclick',
        () => {
          if (canEdit()) this.edit(record.key)
        },
        { signal }
      )
      editor.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Enter' && event.target === editor && canEdit()) {
            event.preventDefault()
            this.edit(record.key)
          }
        },
        { signal }
      )
    } else if (record.kind === 'image') {
      editor.append(document.createElement('canvas'))
    } else {
      const contour = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      contour.classList.add('lepisHighlightContour')
      contour.setAttribute('aria-hidden', 'true')
      contour.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
      editor.append(contour)
    }
    if (record.kind !== 'highlight') {
      const resizers = document.createElement('div')
      resizers.className = 'resizers'
      for (const name of [
        'topLeft',
        'topMiddle',
        'topRight',
        'middleLeft',
        'middleRight',
        'bottomLeft',
        'bottomMiddle',
        'bottomRight'
      ]) {
        const handle = document.createElement('div')
        handle.className = `resizer ${name}`
        handle.dataset.resizerName = name
        handle.addEventListener(
          'pointerdown',
          (event) => {
            if (!canEdit()) return
            event.stopPropagation()
            event.preventDefault()
            select(record.key)
            this.startDrag(record.key, event, name)
          },
          { signal }
        )
        resizers.append(handle)
      }
      editor.append(resizers)
    }
    editor.addEventListener(
      'focusin',
      () => {
        if (canEdit() && this.options.selected() !== record.key) select(record.key)
      },
      { signal }
    )
    editor.addEventListener(
      'pointerdown',
      (event) => {
        if (!canEdit() || event.button !== 0) return
        event.stopPropagation()
        select(record.key)
        if ((event.target as HTMLElement).isContentEditable) return
        event.preventDefault()
        editor.focus({ preventScroll: true })
        if (record.kind !== 'highlight') this.startDrag(record.key, event)
      },
      { signal }
    )
    return editor
  }

  private startDrag(key: string, event: PointerEvent, resize?: string): void {
    const { model, signal } = this.options
    const original = model.records.get(key)!
    model.commit()
    this.drag?.abort()
    const drag = (this.drag = new AbortController())
    const combined = AbortSignal.any([signal, this.lifetime.signal, drag.signal])
    const start = this.point(event.clientX, event.clientY)
    const screen = [event.screenX, event.screenY]
    const originalBounds = this.bounds(original.rect)
    let after = original
    window.addEventListener(
      'pointermove',
      (move) => {
        if (move.pointerId !== event.pointerId) return
        if (!this.options.canEdit()) {
          finish()
          return
        }
        const rect = original.rect.slice() as PdfRect
        if (!resize) {
          const [x, y] = this.point(move.clientX, move.clientY)
          const dx = x - start[0],
            dy = y - start[1]
          rect[0] += dx
          rect[2] += dx
          rect[1] += dy
          rect[3] += dy
        } else {
          const bounds = originalBounds.slice()
          const vx = move.clientX - event.clientX || move.screenX - screen[0]
          const vy = move.clientY - event.clientY || move.screenY - screen[1]
          const left = resize.includes('Left')
          const right = resize.includes('Right')
          const top = resize.startsWith('top')
          const bottom = resize.startsWith('bottom')
          if (original.kind === 'image' && (left || right) && (top || bottom)) {
            const width = bounds[2] - bounds[0]
            const height = bounds[3] - bounds[1]
            const directionX = left ? -1 : 1
            const directionY = top ? -1 : 1
            // Project the pointer movement onto the diagonal through the fixed opposite corner.
            const scaleDelta =
              (directionX * vx * width + directionY * vy * height) /
              (width * width + height * height)
            bounds[left ? 0 : 2] += directionX * width * scaleDelta
            bounds[top ? 1 : 3] += directionY * height * scaleDelta
          } else {
            if (left) bounds[0] += vx
            if (right) bounds[2] += vx
            if (top) bounds[1] += vy
            if (bottom) bounds[3] += vy
          }
          const viewport = this.options.page.viewport
          if (
            bounds[2] - bounds[0] < 8 * viewport.scale ||
            bounds[3] - bounds[1] < 8 * viewport.scale
          )
            return
          const resized = normalizedRect(
            viewport.convertToPdfPoint(bounds[0], bounds[1]),
            viewport.convertToPdfPoint(bounds[2], bounds[3])
          )
          rect.splice(0, 4, ...resized)
        }
        if (rect.every((value, index) => value === after.rect[index])) return
        const next =
          resize && original.kind === 'text'
            ? layoutText({ ...original, rect, textResized: true }, original.text ?? '')
            : { ...original, rect }
        if (next.rect.every((value, index) => value === after.rect[index])) return
        after = next
        model.change(model.records.get(key), after, true)
      },
      { signal: combined }
    )
    const finish = (): void => {
      drag.abort()
      model.commit()
    }
    window.addEventListener('pointerup', finish, { signal: combined, once: true })
    window.addEventListener('blur', finish, { signal: combined, once: true })
    window.addEventListener('pointercancel', finish, { signal: combined, once: true })
  }
}
