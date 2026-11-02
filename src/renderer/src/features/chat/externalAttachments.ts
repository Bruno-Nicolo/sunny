import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { ChatAttachment } from '../../../../shared/ai'
import {
  maxAttachments,
  maxAttachmentCharacters,
  validateAttachments,
  validateAttachmentBudget
} from '../../../../shared/chat-attachments'

const textExtensions = [
  'txt',
  'md',
  'csv',
  'tsv',
  'json',
  'xml',
  'html',
  'css',
  'js',
  'ts',
  'py',
  'yaml',
  'yml',
  'log'
]
const imageTypes = ['image/png', 'image/jpeg', 'image/webp']
export const externalAttachmentAccept = [
  '.pdf',
  ...textExtensions.map((extension) => `.${extension}`),
  ...imageTypes
].join(',')

/** Read a batch locally and reject it atomically before changing the draft. */
export async function readExternalAttachments(
  files: File[],
  existing: ChatAttachment[],
  signal: AbortSignal
): Promise<ChatAttachment[]> {
  if (files.length + existing.length > maxAttachments)
    throw new Error(`Attach at most ${maxAttachments} attachments per message.`)
  const items: ChatAttachment[] = []
  for (const file of files) {
    signal.throwIfAborted()
    items.push(await readFile(file, signal))
    validateAttachmentBudget([...existing, ...items])
  }
  return items
}

async function readFile(file: File, signal: AbortSignal): Promise<ChatAttachment> {
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: maximum file size is 20 MiB.`)
  const attachment: ChatAttachment = {
    id: `a_${crypto.randomUUID()}`,
    kind: 'file',
    name: file.name,
    text: ''
  }
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
  if (imageTypes.includes(file.type)) {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    try {
      signal.throwIfAborted()
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      attachment.image = canvas.toDataURL('image/png')
    } finally {
      bitmap.close()
      canvas.width = canvas.height = 0
    }
  } else if (extension === 'pdf') {
    attachment.text = await readPdfText(file, signal)
  } else if (textExtensions.includes(extension)) {
    attachment.text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    if (attachment.text.includes('\0')) throw new Error(`${file.name}: unsupported binary file.`)
  } else {
    throw new Error(`${file.name}: attach a PDF, text file, PNG, JPEG or WebP image.`)
  }
  signal.throwIfAborted()
  validateAttachments([attachment])
  return attachment
}

async function readPdfText(file: File, signal: AbortSignal): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer())
  signal.throwIfAborted()
  const task = getDocument({ data })
  const cancel = (): void => {
    void task.destroy()
  }
  signal.addEventListener('abort', cancel, { once: true })
  let passwordRequired = false
  task.onPassword = () => {
    passwordRequired = true
    cancel()
  }
  try {
    const pdf = await task.promise
    const pages: string[] = []
    let characters = 0
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted()
      const page = await pdf.getPage(number)
      try {
        const content = await page.getTextContent()
        const text = content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
          .join('')
          .trim()
        if (!text) continue
        const section = `[Page ${number}]\n${text}\n`
        characters += section.length
        if (characters > maxAttachmentCharacters)
          throw new Error(
            `${file.name}: PDF text exceeds the ${maxAttachmentCharacters}-character message budget.`
          )
        pages.push(section)
      } finally {
        page.cleanup()
      }
    }
    if (!pages.length)
      throw new Error(
        `${file.name}: this PDF has no extractable text. Attach images of its pages instead.`
      )
    return pages.join('')
  } catch (error) {
    if (passwordRequired)
      throw new Error(`${file.name}: password-protected PDFs cannot be attached.`)
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    await task.destroy()
  }
}
