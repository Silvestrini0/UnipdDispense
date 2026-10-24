import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManifestStore, type ManifestEntry } from './manifest'

vi.mock('../logger', () => ({
  logger: { warn: vi.fn() }
}))

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'moodlescraper-manifest-'))
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

function entry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    key: 'chiave',
    kind: 'file',
    category: 'material',
    courseId: 1,
    courseName: 'Corso',
    courseFolder: 'Corso',
    courseTag: 'corso/corso',
    sectionId: 2,
    sectionName: 'Sezione',
    sectionFolder: 'Sezione',
    moduleId: 3,
    moduleName: 'Modulo',
    moduleFolder: 'Modulo',
    filename: 'file.pdf',
    filepath: '/',
    mimeType: 'application/pdf',
    size: 10,
    moodleAddedAt: null,
    moodleModifiedAt: null,
    sourcePath: '/pluginfile.php/file.pdf',
    sourceUrl: 'https://example.test/pluginfile.php/file.pdf',
    relativePath: 'Corso/Sezione/Modulo/file.pdf',
    sidecarPath: 'Schede file/Corso/Sezione/Modulo/file.pdf.md',
    noteType: null,
    noteBody: null,
    contentHash: null,
    firstSeenAt: '2024-01-01T00:00:00.000Z',
    lastSeenAt: '2024-01-01T00:00:00.000Z',
    downloadedAt: '2024-01-01T00:00:00.000Z',
    status: 'present',
    removedDetectedAt: null,
    tags: ['moodle', 'unipd'],
    previousTags: [],
    events: [{ type: 'added', at: '2024-01-01T00:00:00.000Z' }],
    ...overrides
  }
}

describe('ManifestStore', () => {
  it('restituisce un manifest vuoto quando il file non esiste', async () => {
    const store = new ManifestStore(vault)
    await expect(store.load()).resolves.toEqual({ version: 1, entries: {} })
  })

  it('salva e ricarica le voci', async () => {
    const store = new ManifestStore(vault)
    const manifest = {
      version: 1 as const,
      entries: { chiave: entry(), avviso: entry({ key: 'avviso', category: 'info' }) }
    }
    await store.save(manifest)
    const raw = await readFile(store.path, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    await expect(store.load()).resolves.toEqual(manifest)
  })

  it('normalizza un manifest precedente alle note', async () => {
    const store = new ManifestStore(vault)
    await mkdir(join(vault, '.moodlescraper'), { recursive: true })
    const legacy = entry()
    const {
      kind: _kind,
      category: _category,
      noteType: _noteType,
      noteBody: _noteBody,
      contentHash: _contentHash,
      ...old
    } = legacy
    await writeFile(store.path, JSON.stringify({ version: 1, entries: { chiave: old } }), 'utf8')
    const loaded = await store.load()
    expect(loaded.entries.chiave).toMatchObject({
      kind: 'file',
      category: 'material',
      noteType: null,
      noteBody: null,
      contentHash: null
    })
  })

  it('sposta un manifest invalido e riparte vuoto', async () => {
    const store = new ManifestStore(vault)
    await mkdir(join(vault, '.moodlescraper'), { recursive: true })
    await writeFile(store.path, '{ non json', 'utf8')
    await expect(store.load()).resolves.toEqual({ version: 1, entries: {} })
    const files = await readdir(join(vault, '.moodlescraper'))
    expect(files.some((file) => file.startsWith('manifest.json.invalid-'))).toBe(true)
  })
})
