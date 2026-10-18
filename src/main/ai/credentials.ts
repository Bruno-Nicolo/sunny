import { safeStorage } from 'electron'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ApiProvider } from '../../shared/ai'

export type ChatgptSession = {
  clientId: string
  subject: string
  email: string
  accessToken: string
  refreshToken: string
  idToken: string
  expiresAt: number
  scope: string
}
type Credentials = {
  hostId: string
  clientId?: string
  session?: ChatgptSession
  keys: Partial<Record<ApiProvider, string>>
}

export class CredentialStore {
  private value: Credentials | null = null
  private pendingLoad: Promise<Credentials> | null = null
  private writes = Promise.resolve()
  constructor(private directory: string) {}

  async load(): Promise<Credentials> {
    if (this.value) return this.value
    if (!this.pendingLoad)
      this.pendingLoad = this.read().finally(() => {
        this.pendingLoad = null
      })
    return this.pendingLoad
  }
  private async read(): Promise<Credentials> {
    try {
      const encrypted = await readFile(join(this.directory, 'credentials.enc'))
      this.assertProtection()
      this.value = JSON.parse(safeStorage.decryptString(encrypted)) as Credentials
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.value = { hostId: `urn:uuid:${randomUUID()}`, keys: {} }
    }
    return this.value
  }
  private assertProtection(): void {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error(
        'Secure system storage is unavailable. Credentials have not been accessed or saved.'
      )
  }
  /** Commit encrypted credentials to disk before exposing the new state to callers. */
  update(change: (credentials: Credentials) => void): Promise<void> {
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        this.assertProtection()
        const next = structuredClone(await this.load())
        change(next)
        const encrypted = safeStorage.encryptString(JSON.stringify(next))
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        const path = join(this.directory, 'credentials.enc')
        const temporary = `${path}.tmp`
        await writeFile(temporary, encrypted, { mode: 0o600 })
        await rename(temporary, path)
        this.value = next
      })
    return this.writes
  }
}
