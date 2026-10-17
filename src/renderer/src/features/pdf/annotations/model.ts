export type PdfRect = [number, number, number, number]
export type ImageAsset = { id: string; canvas: HTMLCanvasElement; rotation: number }

export type Annotation = {
  key: string
  originalId?: string
  popupRef?: string
  pageIndex: number
  rect: PdfRect
  rotation: number
  color: string
  kind: 'highlight' | 'text' | 'image'
  quads?: number[]
  opacity?: number
  text?: string
  fontSize?: number
  image?: ImageAsset
}

type Change = { before?: Annotation; after?: Annotation }

// One document owns its original records, current records and reversible user commands.
export class AnnotationModel {
  readonly originals = new Map<string, Annotation>()
  readonly records = new Map<string, Annotation>()
  private readonly pages = new Map<number, Map<string, Annotation>>()
  private history: Change[] = []
  private position = 0
  private revision = 0
  private readonly sessionId = crypto.randomUUID()
  private pending: Change | null = null

  constructor(private readonly notify: (changed: boolean, key?: string) => void) {}

  get hash(): string {
    return `${this.sessionId}:${this.revision}`
  }

  import(record: Annotation): void {
    if (this.originals.has(record.key)) return
    this.originals.set(record.key, record)
    this.records.set(record.key, record)
    this.index(record)
  }

  forPage(pageIndex: number): Iterable<Annotation> {
    return this.pages.get(pageIndex)?.values() ?? []
  }

  private index(record: Annotation): void {
    let page = this.pages.get(record.pageIndex)
    if (!page) this.pages.set(record.pageIndex, (page = new Map()))
    page.set(record.key, record)
  }

  change(before: Annotation | undefined, after: Annotation | undefined, live = false): void {
    if (before === after) return
    if (!live) this.commit()
    if (live) {
      const key = after?.key ?? before?.key
      if (this.pending && (this.pending.after?.key ?? this.pending.before?.key) !== key)
        this.commit()
      if (!this.pending) this.pending = { before, after }
      else this.pending.after = after
    } else {
      this.history.splice(this.position)
      this.history.push({ before, after })
      this.position++
    }
    this.apply(before, after)
  }

  commit(): void {
    if (!this.pending) return
    this.history.splice(this.position)
    this.history.push(this.pending)
    this.position++
    this.pending = null
  }

  undo(): void {
    this.commit()
    if (this.position === 0) return
    const { before, after } = this.history[--this.position]
    this.apply(after, before)
  }

  redo(): void {
    this.commit()
    if (this.position === this.history.length) return
    const { before, after } = this.history[this.position++]
    this.apply(before, after)
  }

  private apply(before: Annotation | undefined, after: Annotation | undefined): void {
    const key = (after ?? before)!.key
    if (before) this.pages.get(before.pageIndex)?.delete(key)
    if (after) {
      this.records.set(key, after)
      this.index(after)
    } else this.records.delete(key)
    this.revision++
    const hasContent = (record?: Annotation): boolean =>
      !!record && (record.kind !== 'text' || !!record.text?.length)
    this.notify(hasContent(before) || hasContent(after), key)
  }

  dispose(): void {
    const assets = new Set<ImageAsset>()
    for (const record of [...this.records.values(), ...this.originals.values()]) {
      if (record.image) assets.add(record.image)
    }
    for (const { before, after } of this.history) {
      if (before?.image) assets.add(before.image)
      if (after?.image) assets.add(after.image)
    }
    for (const asset of assets) asset.canvas.width = asset.canvas.height = 0
    this.records.clear()
    this.pages.clear()
    this.originals.clear()
    this.history.length = 0
    this.pending = null
  }
}
