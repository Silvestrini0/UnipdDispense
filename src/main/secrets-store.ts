import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { AuthUser, SecureStorageState } from '../shared/types'
import { errorMessage, logger } from './logger'

export interface TokenRecord {
  token: string
  privateToken: string | null
  siteId: string
  baseUrl?: string
  user: AuthUser | null
}

interface SecretsData {
  token: TokenRecord | null
}

const emptySecrets = (): SecretsData => ({
  token: null
})

function isTokenRecord(value: unknown): value is TokenRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.token === 'string' && record.token.length > 0
}

function parseSecrets(value: unknown): SecretsData {
  if (!value || typeof value !== 'object') {
    return emptySecrets()
  }
  const record = value as Record<string, unknown>
  return {
    token: isTokenRecord(record.token) ? record.token : null
  }
}

export class SecretsStore {
  private data: SecretsData = emptySecrets()
  private loaded = false
  private writeChain: Promise<void> = Promise.resolve()
  private storageState: SecureStorageState = 'unavailable'

  constructor(private readonly filePath: string) {}

  get secureStorage(): SecureStorageState {
    return this.storageState
  }

  get canPersist(): boolean {
    return this.storageState !== 'unavailable'
  }

  async load(): Promise<void> {
    if (this.loaded) {
      return
    }
    this.loaded = true
    this.storageState = await SecretsStore.detectStorageState()
    if (!this.canPersist) {
      return
    }
    try {
      const encrypted = await readFile(this.filePath)
      const decrypted = await safeStorage.decryptStringAsync(encrypted)
      this.data = parseSecrets(JSON.parse(decrypted.result))
      if (decrypted.shouldReEncrypt) {
        await this.persist().catch((error) => {
          logger.warn('Impossibile rigenerare i segreti salvati:', errorMessage(error))
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Impossibile leggere i segreti salvati:', errorMessage(error))
        await this.backupInvalidFile()
      }
    }
  }

  getToken(): TokenRecord | null {
    return this.data.token ? { ...this.data.token } : null
  }

  async setToken(token: TokenRecord): Promise<void> {
    this.data.token = { ...token }
    await this.persist()
  }

  async clearToken(): Promise<void> {
    this.data.token = null
    await this.persist()
  }

  async updateCachedUser(user: AuthUser | null): Promise<void> {
    if (!this.data.token) {
      return
    }
    this.data.token.user = user
    await this.persist()
  }

  private async persist(): Promise<void> {
    if (!this.canPersist) {
      return
    }
    const run = this.writeChain.then(async () => {
      const payload = await safeStorage.encryptStringAsync(JSON.stringify(this.data))
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      await writeFile(temporaryPath, payload, { mode: 0o600 })
      await rename(temporaryPath, this.filePath)
    })
    this.writeChain = run.catch(() => undefined)
    await run
  }

  private async backupInvalidFile(): Promise<void> {
    try {
      await rename(this.filePath, `${this.filePath}.invalid-${Date.now()}`)
    } catch {
      return
    }
  }

  private static async detectStorageState(): Promise<SecureStorageState> {
    try {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        return 'unavailable'
      }
      if (process.platform === 'linux') {
        const backend = safeStorage.getSelectedStorageBackend()
        if (backend === 'basic_text') {
          return 'basic-text'
        }
      }
      return 'secure'
    } catch {
      return 'unavailable'
    }
  }
}
