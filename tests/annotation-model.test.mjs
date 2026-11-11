import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import {
  getDocument,
  GlobalWorkerOptions,
  OPS,
  PDFDataRangeTransport
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import { blankPdf, createPdf } from './fixtures/pdf.mjs'

GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
async function sourceModule(name) {
  let source = await readFile(
    new URL(`../src/renderer/src/features/pdf/annotations/${name}.ts`, import.meta.url),
    'utf8'
  )
  source = source.replaceAll(
    "'pdfjs-dist/legacy/build/pdf.mjs'",
    JSON.stringify(import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
  )
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { AnnotationModel } = await sourceModule('model')
const { writeAnnotations } = await sourceModule('pdfAnnotationWriter')
async function open(t, bytes, options = {}) {
  const task = getDocument({
    ...options,
    data: bytes.slice(),
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname
  })
  t.after(() => task.destroy())
  return task.promise
}
const textRecord = {
  key: 'text',
  kind: 'text',
  pageIndex: 0,
  rect: [50, 600, 250, 650],
  rotation: 0,
  fontSize: 16,
  color: '#000000',
  text: 'Caffè: città, perché'
}

test('live text and drag updates form one reversible command; imports do not dirty the document', () => {
  const changes = []
  const model = new AnnotationModel((dirty) => changes.push(dirty))
  model.import(textRecord)
  assert.deepEqual(changes, [])
  for (const text of ['A', 'AB', 'ABC'])
    model.change(model.records.get('text'), { ...textRecord, text }, true)
  model.undo()
  assert.equal(model.records.get('text'), textRecord)
  model.redo()
  assert.equal(model.records.get('text').text, 'ABC')
  model.change(model.records.get('text'), undefined)
  model.undo()
  assert.equal(model.records.get('text').text, 'ABC')
  model.undo()
  model.change(model.records.get('text'), { ...textRecord, color: '#ff0000' })
  model.redo()
  assert.equal(model.records.get('text').color, '#ff0000', 'A new edit replaces the redo branch')
})

test('app-owned text saves incrementally, reopens and updates the original PDF object', async (t) => {
  const document = await open(t, blankPdf)
  const model = new AnnotationModel(() => {})
  model.change(undefined, textRecord)
  const bytes = await writeAnnotations(document, model)
  assert.deepEqual(bytes.subarray(0, blankPdf.length), blankPdf)
  const reopened = await open(t, bytes)
  const [text] = await (await reopened.getPage(1)).getAnnotations()
  assert.equal(text.subtype, 'FreeText')
  assert.equal(text.contentsObj.str, textRecord.text)
  const edited = new AnnotationModel(() => {})
  const original = { ...textRecord, key: text.id, originalId: text.id }
  edited.import(original)
  edited.change(original, { ...original, text: 'Edited', color: '#ff0000', fontSize: 24 })
  const updated = await open(t, await writeAnnotations(reopened, edited))
  const [result] = await (await updated.getPage(1)).getAnnotations()
  assert.equal(result.id, text.id)
  assert.equal(result.contentsObj.str, 'Edited')
  assert.equal(result.defaultAppearanceData.fontSize, 24)
  assert.deepEqual([...result.defaultAppearanceData.fontColor], [255, 0, 0])
})

test('display exclusion preserves original annotations in PDF output and print rendering', async (t) => {
  const input = createPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R /Annots [5 0 R 6 0 R] >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    '<< /Type /Annot /Subtype /Highlight /Rect [50 600 150 620] /QuadPoints [50 620 150 620 50 600 150 600] /C [1 1 0] /F 4 >>',
    '<< /Type /Annot /Subtype /Square /Rect [200 600 250 650] /C [1 0 0] /F 4 /BS << /W 2 >> /NM (preserve-me) /CustomKey (original) >>'
  ])
  const document = await open(t, input)
  document.annotationStorage.setOverlayAnnotationIds(0, ['5R'])
  const page = await document.getPage(1)
  const display = await page.getOperatorList()
  const annotationIds = (list) =>
    list.fnArray.flatMap((op, index) =>
      op === OPS.beginAnnotation ? [list.argsArray[index][0]] : []
    )
  assert.deepEqual(annotationIds(display), ['6R'])
  document.annotationStorage.setOverlayAnnotationIds(1, ['other-page'])
  assert.equal(
    await page.getOperatorList(),
    display,
    'Importing another page must reuse this page rendering cache'
  )
  assert.deepEqual(annotationIds(await page.getOperatorList({ intent: 'print' })), ['5R', '6R'])
  assert.equal(
    document.annotationStorage.serializable.map,
    null,
    'A display exclusion is not a PDF edit'
  )
  const model = new AnnotationModel(() => {})
  model.change(undefined, textRecord)
  const bytes = await writeAnnotations(document, model)
  assert.ok(Buffer.from(bytes).includes(Buffer.from('/CustomKey (original)')))
  const annotations = await (await (await open(t, bytes)).getPage(1)).getAnnotations()
  assert.deepEqual(annotations.map((annotation) => annotation.subtype).sort(), [
    'FreeText',
    'Highlight',
    'Square'
  ])
})

test('native arrow proof creates, updates appearance and deletes a standard Line annotation', async (t) => {
  const document = await open(t, blankPdf)
  const record = {
    annotationType: 'lepis-line',
    pageIndex: 0,
    rect: [40, 590, 260, 660],
    line: [50, 600, 250, 650],
    color: [255, 0, 0],
    width: 2,
    arrow: true
  }
  document.annotationStorage.setValue('pdfjs_internal_editor_arrow', record)
  const reopened = await open(t, await document.saveDocument())
  const [arrow] = await (await reopened.getPage(1)).getAnnotations()
  assert.equal(arrow.subtype, 'Line')
  assert.equal(arrow.hasAppearance, true)
  assert.deepEqual(arrow.lineEndings, ['None', 'ClosedArrow'])
  reopened.annotationStorage.setValue('pdfjs_internal_editor_arrow', {
    ...record,
    id: arrow.id,
    line: [60, 610, 240, 640],
    color: [0, 0, 255]
  })
  const updated = await open(t, await reopened.saveDocument())
  const [result] = await (await updated.getPage(1)).getAnnotations()
  assert.equal(result.id, arrow.id)
  assert.deepEqual(result.lineCoordinates, [60, 610, 240, 640])
  assert.deepEqual([...result.color], [0, 0, 255])
  assert.ok((await (await updated.getPage(1)).getOperatorList()).fnArray.length > 0)
  updated.annotationStorage.setValue('pdfjs_internal_editor_arrow', {
    id: arrow.id,
    deleted: true,
    pageIndex: 0
  })
  const deleted = await open(t, await updated.saveDocument())
  assert.deepEqual(await (await deleted.getPage(1)).getAnnotations(), [])
})

test('password-protected PDFs keep encryption and can save editable annotations', async (t) => {
  const input = new Uint8Array(
    await readFile(new URL('./fixtures/annotation-password.pdf', import.meta.url))
  )
  const document = await open(t, input, { password: 'annotation-test' })
  const model = new AnnotationModel(() => {})
  model.change(undefined, textRecord)
  const bytes = await writeAnnotations(document, model)
  assert.deepEqual(bytes.subarray(0, input.length), input)
  const locked = getDocument({ data: bytes.slice() })
  await assert.rejects(locked.promise, (error) => error.name === 'PasswordException')
  await locked.destroy()
  const reopened = await open(t, bytes, { password: 'annotation-test' })
  const [text] = await (await reopened.getPage(1)).getAnnotations()
  assert.equal(text.contentsObj.str, textRecord.text)
})

test('creating, formatting and discarding an empty text box does not dirty the PDF', () => {
  const dirty = []
  const model = new AnnotationModel((changed) => {
    if (changed) dirty.push(true)
  })
  const empty = { ...textRecord, text: '' }
  model.change(undefined, empty, true)
  model.change(empty, { ...empty, fontSize: 24 })
  model.change(model.records.get(empty.key), undefined)
  assert.deepEqual(dirty, [])
})

test('text layout preserves its anchor at each saved rotation', async () => {
  const { textRect } = await sourceModule('geometry')
  const record = { ...textRecord, rect: [10, 20, 110, 70] }
  const expected = [
    [10, 30, 210, 70],
    [10, 20, 50, 220],
    [-90, 20, 110, 60],
    [70, -130, 110, 70]
  ]
  for (const [index, rotation] of [0, 90, 180, 270].entries()) {
    assert.deepEqual(textRect({ ...record, rotation }, 200, 40), expected[index])
  }
})

test('replacing a viewer cannot reuse another session recovery revision', () => {
  const first = new AnnotationModel(() => {})
  const second = new AnnotationModel(() => {})
  first.change(undefined, textRecord)
  second.change(undefined, textRecord)
  assert.notEqual(first.hash, second.hash)
})

test('signature fields remain detectable when optional AcroForm SigFlags are omitted', async (t) => {
  const bytes = createPdf([
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    '<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature) /Rect [0 0 100 40] /P 3 0 R /V 6 0 R >>',
    '<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 1 5 1] /Contents <0102> >>'
  ])
  const document = await open(t, bytes)
  assert.equal((await document.getSignatures())?.length, 1)
})

test('page cleanup preserves rereading and updates to the original annotation object', async (t) => {
  const initial = await open(t, blankPdf)
  const model = new AnnotationModel(() => {})
  model.change(undefined, textRecord)
  const document = await open(t, await writeAnnotations(initial, model))
  const page = await document.getPage(1)
  const [annotation] = await page.getAnnotations()
  await page.getOperatorList()
  assert.equal(page.cleanup(), true)
  const [reread] = await page.getAnnotations()
  assert.equal(reread.id, annotation.id)
  assert.equal(reread.contentsObj.str, textRecord.text)
  const edits = new AnnotationModel(() => {})
  const original = { ...textRecord, key: reread.id, originalId: reread.id }
  edits.import(original)
  edits.change(original, { ...original, text: 'Edited after cleanup' })
  const reopened = await open(t, await writeAnnotations(document, edits))
  const annotations = await (await reopened.getPage(1)).getAnnotations()
  assert.equal(annotations.length, 1)
  assert.equal(annotations[0].id, annotation.id)
  assert.equal(annotations[0].contentsObj.str, 'Edited after cleanup')
})

test('range-loaded PDFs preserve sparse reads, full data and incremental annotation output', async (t) => {
  const padding = 'x'.repeat(200 * 1024)
  const content = 'BT /F1 12 Tf 72 700 Td (A) Tj ET'
  const cmap =
    '%' +
    'x'.repeat(1600) +
    '\n/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <03A9> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end'
  const input = createPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>',
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
    `<< /Length ${padding.length} >>\nstream\n${padding}\nendstream`
  ])
  let read = 0
  class RangeSource extends PDFDataRangeTransport {
    constructor() {
      super(input.length, input.slice(0, 7), true)
    }
    requestDataRange(begin, end) {
      read += end - begin
      queueMicrotask(() => this.onDataRange(begin, input.slice(begin, end)))
    }
  }
  const task = getDocument({
    range: new RangeSource(),
    rangeChunkSize: 1024,
    disableAutoFetch: true,
    disableStream: true,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname
  })
  t.after(() => task.destroy())
  const document = await task.promise
  const page = await document.getPage(1)
  await page.getOperatorList()
  assert.equal((await page.getTextContent()).items.map((item) => item.str).join(''), 'Ω')
  assert.ok(read < input.length / 2, 'Opening must not request the unreferenced stream')
  const model = new AnnotationModel(() => {})
  model.change(undefined, textRecord)
  const output = await writeAnnotations(document, model)
  assert.deepEqual(output.subarray(0, input.length), input)
  assert.deepEqual(await document.getData(), input)
  assert.equal((await document.getDownloadInfo()).length, input.length)
  const reopened = await open(t, output)
  assert.equal(
    (await (await reopened.getPage(1)).getAnnotations())[0].contentsObj.str,
    textRecord.text
  )
})

test('page cleanup retains stable IDs for native annotations without indirect references', async (t) => {
  const input = createPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Annots [<< /Type /Annot /Subtype /Link /Rect [50 600 200 630] /A << /S /URI /URI (https://example.com/) >> >>] >>'
  ])
  const document = await open(t, input)
  const page = await document.getPage(1)
  const [before] = await page.getAnnotations()
  await page.getOperatorList()
  assert.equal(page.cleanup(), true)
  const [after] = await page.getAnnotations()
  assert.equal(after.id, before.id)
})

test('freehand highlights retain ink geometry through save, recolor, undo and deletion', async (t) => {
  const document = await open(t, blankPdf)
  const model = new AnnotationModel(() => {})
  const record = {
    key: 'freehand',
    kind: 'highlight',
    pageIndex: 0,
    rotation: 0,
    rect: [94, 594, 186, 646],
    color: '#fde047',
    opacity: 0.5,
    thickness: 12,
    strokes: [[100, 600, 130, 640, 180, 610]]
  }
  model.change(undefined, record)
  const reopened = await open(t, await writeAnnotations(document, model))
  const [ink] = await (await reopened.getPage(1)).getAnnotations()
  assert.equal(ink.subtype, 'Ink')
  assert.deepEqual(
    ink.inkLists.map((points) => Array.from(points)),
    record.strokes
  )
  assert.equal(ink.borderStyle.rawWidth, 12)
  assert.equal(ink.opacity, 0.5)
  const edited = new AnnotationModel(() => {})
  const original = { ...record, key: ink.id, originalId: ink.id }
  edited.import(original)
  edited.change(original, { ...original, color: '#ff0000' })
  const updated = await open(t, await writeAnnotations(reopened, edited))
  const [result] = await (await updated.getPage(1)).getAnnotations()
  assert.equal(result.id, ink.id)
  assert.deepEqual(Array.from(result.color), [255, 0, 0])
  assert.deepEqual(
    result.inkLists.map((points) => Array.from(points)),
    record.strokes
  )
  edited.undo()
  assert.equal(edited.records.get(ink.id), original)
  edited.redo()
  edited.change(edited.records.get(ink.id), undefined)
  const deleted = await open(t, await writeAnnotations(reopened, edited))
  assert.equal((await (await deleted.getPage(1)).getAnnotations()).length, 0)
})
