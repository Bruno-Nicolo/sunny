import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { SavedSignature, SignaturesApi } from '../shared/signatures'
import { writeFileAtomically } from './atomic-write'

function signatureName(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100)
    throw new Error('Enter a signature name of up to 100 characters.')
  return value.trim()
}

function isSignatureImage(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 8 * 1024 * 1024 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

// Keep the signature library in app data, separately from documents and recovery.
export function createSignatureStore(directory: string): SignaturesApi {
  const file = join(directory, 'signatures.json')
  let queue: Promise<void> = Promise.resolve()
  async function read(): Promise<SavedSignature[]> {
    try {
      const items: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
      if (
        !Array.isArray(items) ||
        items.some(
          (item) =>
            !item ||
            typeof item.id !== 'string' ||
            typeof item.name !== 'string' ||
            !item.name.trim() ||
            item.name.length > 100 ||
            !isSignatureImage(item.dataUrl)
        )
      )
        throw new Error('Invalid signature library.')
      return items
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('The saved signature library could not be opened.')
    }
  }
  function update(action: (items: SavedSignature[]) => void): Promise<void> {
    const operation = queue.then(async () => {
      const items = await read()
      action(items)
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFileAtomically(file, JSON.stringify(items), 0o600)
    })
    queue = operation.catch(() => {})
    return operation
  }
  return {
    async list() {
      await queue
      return read()
    },
    async save(name, dataUrl) {
      if (!isSignatureImage(dataUrl))
        throw new Error('The signature must be a PNG image smaller than 6 MB.')
      const item = { id: randomUUID(), name: signatureName(name), dataUrl }
      await update((items) => items.push(item))
      return item
    },
    async rename(id, name) {
      const next = signatureName(name)
      await update((items) => {
        const item = items.find((item) => item.id === id)
        if (!item) throw new Error('This saved signature no longer exists.')
        item.name = next
      })
    },
    async remove(id) {
      await update((items) => {
        const index = items.findIndex((item) => item.id === id)
        if (index !== -1) items.splice(index, 1)
      })
    }
  }
}
