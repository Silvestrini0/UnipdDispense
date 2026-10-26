import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MaterialCategory } from './classify'
import { logger } from '../logger'

export type FileStatus = 'present' | 'removed'
export type EntryKind = 'file' | 'note'

export interface FileEvent {
  type: 'added' | 'removed' | 'restored'
  at: string
}

export interface ManifestEntry {
  key: string
  kind: EntryKind
  category: MaterialCategory
  courseId: number
  courseName: string
  courseFolder: string
  courseTag: string
  sectionId: number
  sectionName: string
  sectionFolder: string
  moduleId: number
  moduleName: string
  moduleFolder: string
  filename: string
  filepath: string
  mimeType: string
  size: number
  moodleAddedAt: string | null
  moodleModifiedAt: string | null
  sourcePath: string
  sourceUrl: string
  relativePath: string
  sidecarPath: string
  firstSeenAt: string
  lastSeenAt: string
  downloadedAt: string
  status: FileStatus
  removedDetectedAt: string | null
  tags: string[]
  previousTags: string[]
  events: FileEvent[]
  noteType: string | null
  noteBody: string | null
  contentHash: string | null
  downloadHash?: string | null
  pendingNoteUpdate?: boolean
  pendingSidecarUpdate?: boolean
}

export interface SyncManifest {
  version: 1
  entries: Record<string, ManifestEntry>
  generatedHashes?: Record<string, string>
  interrupted?: boolean
}

function emptyManifest(): SyncManifest {
  return { version: 1, entries: {} }
}

export class ManifestStore {
  private readonly manifestPath: string

  constructor(private readonly vaultPath: string) {
    this.manifestPath = join(vaultPath, '.moodlescraper', 'manifest.json')
  }

  async load(): Promise<SyncManifest> {
    try {
      const raw = await readFile(this.manifestPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<SyncManifest>
      if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
        throw new Error('Formato manifest non riconosciuto.')
      }
      const entries: Record<string, ManifestEntry> = {}
      for (const [key, value] of Object.entries(parsed.entries)) {
        if (!value || typeof value !== 'object') {
          continue
        }
        const entry = value as Partial<ManifestEntry>
        entries[key] = {
          ...entry,
          kind: entry.kind === 'note' ? 'note' : 'file',
          category: entry.category === 'info' ? 'info' : 'material',
          noteType: typeof entry.noteType === 'string' ? entry.noteType : null,
          noteBody: typeof entry.noteBody === 'string' ? entry.noteBody : null,
          contentHash: typeof entry.contentHash === 'string' ? entry.contentHash : null,
          ...(typeof entry.downloadHash === 'string'
            ? { downloadHash: entry.downloadHash }
            : {})
        } as ManifestEntry
      }
      const generatedHashes =
        parsed.generatedHashes && typeof parsed.generatedHashes === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.generatedHashes).filter(
                (item): item is [string, string] => typeof item[1] === 'string'
              )
            )
          : undefined
      return {
        version: 1,
        entries,
        ...(generatedHashes ? { generatedHashes } : {}),
        ...(parsed.interrupted === true ? { interrupted: true } : {})
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Manifest non leggibile, ne creo uno nuovo:', String(error))
        await this.backupInvalidFile()
      }
      return emptyManifest()
    }
  }

  async save(manifest: SyncManifest): Promise<void> {
    await mkdir(dirname(this.manifestPath), { recursive: true })
    const temporaryPath = `${this.manifestPath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await rename(temporaryPath, this.manifestPath)
  }

  get path(): string {
    return this.manifestPath
  }

  private async backupInvalidFile(): Promise<void> {
    try {
      await rename(this.manifestPath, `${this.manifestPath}.invalid-${Date.now()}`)
    } catch {
      return
    }
  }
}
