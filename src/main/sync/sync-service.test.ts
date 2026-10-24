import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, SyncOptions, SyncResult } from '../../shared/types'
import type { AuthService } from '../auth/auth-service'
import type { MoodleApi } from '../moodle/api'
import type {
  MoodleContent,
  MoodleCourse,
  MoodleModule,
  MoodleSection
} from '../moodle/types'
import type { SettingsStore } from '../settings-store'
import { SyncService } from './sync-service'

let vault: string

afterEach(async () => {
  if (vault) {
    await rm(vault, { recursive: true, force: true })
  }
})

const baseUrl = 'https://elearning.unipd.it/dlm'

function content(overrides: Partial<MoodleContent> = {}): MoodleContent {
  return {
    type: 'file',
    filename: 'dispensa.pdf',
    filepath: '/',
    filesize: 3,
    fileurl: `${baseUrl}/pluginfile.php/1/mod_resource/content/1/dispensa.pdf`,
    mimetype: 'application/pdf',
    timecreated: 1700000000,
    timemodified: 1700000100,
    ...overrides
  }
}

function module(overrides: Partial<MoodleModule> = {}): MoodleModule {
  return {
    id: 20,
    name: 'Dispensa',
    visible: 1,
    uservisible: true,
    modname: 'resource',
    contents: [content()],
    ...overrides
  }
}

function section(modules: MoodleModule[]): MoodleSection {
  return { id: 30, name: 'Generale', visible: 1, modules }
}

function course(): MoodleCourse {
  return {
    id: 10,
    shortname: 'analisi-1',
    fullname: 'Analisi Matematica I',
    displayname: 'Analisi Matematica I',
    visible: 1
  }
}

function pageModule(): MoodleModule {
  return module({
    id: 60,
    name: 'Appunti',
    modname: 'page',
    contents: [
      content({
        filename: 'index.html',
        mimetype: 'text/html',
        filesize: 42,
        fileurl: `${baseUrl}/pluginfile.php/1/mod_page/content/1/index.html`
      })
    ]
  })
}

function urlModule(): MoodleModule {
  return module({
    id: 62,
    name: 'Video',
    modname: 'url',
    description: '<p>Guarda il video</p>',
    contents: [
      content({
        type: 'url',
        filename: 'Video lezione',
        filesize: 0,
        fileurl: 'https://example.com/video'
      })
    ]
  })
}

function labelModule(): MoodleModule {
  return module({
    id: 63,
    name: 'Avviso',
    modname: 'label',
    description: '<p>Benvenuti nel corso</p>',
    contents: []
  })
}

describe('SyncService note', () => {
  it('scrive note, mantiene lo skip e conserva le note rimosse', async () => {
    vault = await mkdtemp(join(tmpdir(), 'unipddispense-sync-'))
    const fetched: string[] = []
    let modules = [pageModule(), urlModule(), labelModule(), module()]

    const api = {
      getSiteInfo: async () => ({ userid: 1, siteurl: baseUrl }),
      getUsersCourses: async () => [course()],
      getCourseContents: async () => [section(modules)],
      fetchFile: async (url: string) => {
        fetched.push(url)
        if (url.includes('mod_page')) {
          return new Response('<html><body><h2>Appunti</h2><p>Testo della pagina</p></body></html>')
        }
        return new Response('pdf')
      }
    } as unknown as MoodleApi

    const settingsValue = {
      vaultPath: vault,
      syncAllCourses: true,
      selectedCourseIds: []
    } as unknown as AppSettings
    const settings = {
      get: () => settingsValue,
      update: vi.fn(async () => undefined)
    } as unknown as SettingsStore
    const service = new SyncService({} as AuthService, settings)
    const run = (
      service as unknown as {
        syncWithApi: (
          api: MoodleApi,
          vaultPath: string,
          settings: AppSettings,
          options: SyncOptions
        ) => Promise<SyncResult>
      }
    ).syncWithApi.bind(service)

    const first = await run(api, vault, settingsValue, {})
    expect(first.downloaded).toBe(4)
    expect(fetched).toHaveLength(2)
    const page = await readFile(
      join(vault, 'Analisi Matematica I/Materiali/01 - Generale/Appunti.md'),
      'utf8'
    )
    expect(page).toContain('moodle_type: "page"')
    expect(page).toContain('Testo della pagina')
    await expect(
      readFile(
        join(vault, 'Analisi Matematica I/Materiali/01 - Generale/Video lezione.md'),
        'utf8'
      )
    ).resolves.toContain('[Apri risorsa](<https://example.com/video>)')
    await expect(
      readFile(
        join(vault, 'Analisi Matematica I/Informazioni/Generale/Avviso/Etichetta.md'),
        'utf8'
      )
    ).resolves.toContain('Benvenuti nel corso')

    const second = await run(api, vault, settingsValue, {})
    expect(second.downloaded).toBe(0)
    expect(second.skipped).toBe(4)
    expect(fetched).toHaveLength(2)

    modules = modules.filter((entry) => entry.id !== 60)
    const third = await run(api, vault, settingsValue, {})
    expect(third.removed).toBe(1)
    const removedPage = await readFile(
      join(vault, 'Analisi Matematica I/Materiali/01 - Generale/Appunti.md'),
      'utf8'
    )
    expect(removedPage).toContain('> [!warning] Rimosso da Moodle')
    expect(removedPage).toContain('Testo della pagina')
  })
})

describe('SyncService riordino', () => {
  it('sposta i file nel nuovo layout senza riscaricarli', async () => {
    vault = await mkdtemp(join(tmpdir(), 'unipddispense-sync-'))
    const fetched: string[] = []
    const api = {
      getSiteInfo: async () => ({ userid: 1, siteurl: baseUrl }),
      getUsersCourses: async () => [course()],
      getCourseContents: async () => [section([module()])],
      fetchFile: async (url: string) => {
        fetched.push(url)
        return new Response('pdf')
      }
    } as unknown as MoodleApi

    const settingsValue = {
      vaultPath: vault,
      syncAllCourses: true,
      selectedCourseIds: []
    } as unknown as AppSettings
    const settings = {
      get: () => settingsValue,
      update: vi.fn(async () => undefined)
    } as unknown as SettingsStore
    const service = new SyncService({} as AuthService, settings)
    const run = (
      service as unknown as {
        syncWithApi: (
          api: MoodleApi,
          vaultPath: string,
          settings: AppSettings,
          options: SyncOptions
        ) => Promise<SyncResult>
      }
    ).syncWithApi.bind(service)

    const first = await run(api, vault, settingsValue, {})
    expect(first.downloaded).toBe(1)
    expect(fetched).toHaveLength(1)

    const newPath = 'Analisi Matematica I/Materiali/01 - Generale/dispensa.pdf'
    const oldPath = 'Analisi Matematica I/Generale/Dispensa/dispensa.pdf'
    await mkdir(dirname(join(vault, oldPath)), { recursive: true })
    await rename(join(vault, newPath), join(vault, oldPath))
    await mkdir(dirname(join(vault, `Schede file/${oldPath}.md`)), { recursive: true })
    await rename(join(vault, `Schede file/${newPath}.md`), join(vault, `Schede file/${oldPath}.md`))
    await writeFile(join(vault, newPath), 'file personale')

    const manifestFile = join(vault, '.moodlescraper/manifest.json')
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
      entries: Record<string, { relativePath: string; sidecarPath: string }>
    }
    const entry = Object.values(manifest.entries)[0]
    if (!entry) {
      throw new Error('Manifest senza voci.')
    }
    entry.relativePath = oldPath
    entry.sidecarPath = `Schede file/${oldPath}.md`
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    fetched.length = 0
    const second = await run(api, vault, settingsValue, {})
    expect(second.downloaded).toBe(0)
    expect(second.skipped).toBe(1)
    expect(fetched).toHaveLength(0)
    await expect(readFile(join(vault, newPath), 'utf8')).resolves.toBe('file personale')
    const movedManifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
      entries: Record<string, { relativePath: string; sidecarPath: string }>
    }
    const movedEntry = Object.values(movedManifest.entries)[0]
    if (!movedEntry) {
      throw new Error('Manifest senza voci dopo lo spostamento.')
    }
    const movedPath = movedEntry.relativePath
    expect(movedPath).not.toBe(newPath)
    expect(movedPath).toContain('dispensa (20-')
    await expect(readFile(join(vault, movedPath), 'utf8')).resolves.toBe('pdf')
    await expect(readFile(join(vault, oldPath), 'utf8')).rejects.toThrow()
    await expect(readFile(join(vault, movedEntry.sidecarPath), 'utf8')).resolves.toContain(
      'dispensa.pdf'
    )

    const third = await run(api, vault, settingsValue, {})
    expect(third.downloaded).toBe(0)
    expect(third.skipped).toBe(1)
    expect(fetched).toHaveLength(0)
  })
})
