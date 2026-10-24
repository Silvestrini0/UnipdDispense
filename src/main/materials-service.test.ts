import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openPath: vi.fn(async () => ''),
  loadURL: vi.fn(async (_url: string) => undefined),
  show: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    }
    once = vi.fn((_event: string, callback: () => void) => callback())
    show = mocks.show
    loadURL = mocks.loadURL
  },
  shell: {
    openPath: mocks.openPath,
    openExternal: vi.fn()
  }
}))

import { MaterialsService } from './materials-service'
import { ManifestStore } from './sync/manifest'
import type { SettingsStore } from './settings-store'

let vault: string
let outside: string
let service: MaterialsService

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'unipddispense-materials-'))
  outside = await mkdtemp(join(tmpdir(), 'unipddispense-outside-'))
  service = new MaterialsService(
    { get: () => ({ vaultPath: vault }) } as unknown as SettingsStore,
    () => null
  )
})

afterEach(async () => {
  await Promise.all([
    rm(vault, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ])
  vi.clearAllMocks()
})

describe('MaterialsService', () => {
  it('scansiona il vault e arricchisce i file gestiti con il manifest', async () => {
    const slidePath = 'Analisi/Materiali/01 - Lezione 1/slide.pdf'
    await mkdir(join(vault, 'Analisi/Materiali/01 - Lezione 1'), { recursive: true })
    await mkdir(join(vault, 'Analisi/Informazioni/Generale'), { recursive: true })
    await mkdir(join(vault, '.obsidian'), { recursive: true })
    await mkdir(join(vault, 'Schede file/Analisi'), { recursive: true })
    await writeFile(join(vault, slidePath), 'pdf')
    await writeFile(join(vault, 'Analisi/Informazioni/Generale/orari.pdf'), 'pdf')
    await writeFile(join(vault, '.obsidian/workspace.json'), '{}')
    await writeFile(join(vault, 'Schede file/Analisi/slide.pdf.md'), 'sidecar')
    const externalFile = join(outside, 'fuori.pdf')
    await writeFile(externalFile, 'outside')
    await symlink(externalFile, join(vault, 'Analisi/Materiali/01 - Lezione 1/collegamento.pdf'))

    await new ManifestStore(vault).save({
      version: 1,
      entries: {
        slide: {
          relativePath: slidePath,
          filename: 'slide.pdf',
          courseFolder: 'Analisi',
          category: 'material',
          sectionFolder: '01 - Lezione 1',
          moduleFolder: 'Slide',
          mimeType: 'application/pdf',
          moodleModifiedAt: '2026-10-20T10:00:00.000Z',
          kind: 'file',
          status: 'removed'
        } as never
      }
    })

    const files = await service.list()
    expect(files).toHaveLength(2)
    expect(files.find((file) => file.relativePath === slidePath)).toMatchObject({
      courseFolder: 'Analisi',
      category: 'material',
      sectionFolder: '01 - Lezione 1',
      moduleFolder: 'Slide',
      status: 'removed',
      managed: true
    })
    expect(files.find((file) => file.filename === 'orari.pdf')).toMatchObject({
      category: 'info',
      status: 'present',
      managed: false
    })
  })

  it('apre file e cartelle solo dopo aver verificato il percorso nel vault', async () => {
    await mkdir(join(vault, 'Corso/Materiali'), { recursive: true })
    await writeFile(join(vault, 'Corso/Materiali/appunti.pdf'), 'pdf')
    await writeFile(join(vault, 'Corso/Materiali/run.sh'), 'echo no')
    await writeFile(join(vault, 'Corso/Materiali/pagina.html'), '<script></script>')
    await writeFile(join(outside, 'fuori.pdf'), 'outside')
    await symlink(join(outside, 'fuori.pdf'), join(vault, 'Corso/Materiali/link.pdf'))
    await service.open('Corso/Materiali/appunti.pdf', 'default')
    expect(mocks.openPath).toHaveBeenCalledWith(join(vault, 'Corso/Materiali/appunti.pdf'))
    await service.open('Corso/Materiali/appunti.pdf', 'folder')
    expect(mocks.openPath).toHaveBeenLastCalledWith(join(vault, 'Corso/Materiali'))
    await expect(service.open('../outside.pdf', 'default')).rejects.toThrow('Percorso del file non valido')
    await expect(service.open('Corso/Materiali/run.sh', 'default')).rejects.toThrow('non può essere aperto')
    await expect(service.open('Corso/Materiali/pagina.html', 'default')).rejects.toThrow('non può essere aperto')
    await expect(service.open('Corso/Materiali/link.pdf', 'default')).rejects.toThrow('esce dal vault')
  })

  it('mostra le note in anteprima come testo escapato e sicuro', async () => {
    await mkdir(join(vault, 'Corso/Materiali'), { recursive: true })
    await writeFile(join(vault, 'Corso/Materiali/nota.md'), '# Nota\n<script>alert(1)</script>')
    await service.preview('Corso/Materiali/nota.md')
    const target = mocks.loadURL.mock.calls[0]?.[0]
    expect(target).toMatch(/^data:text\/html/)
    expect(decodeURIComponent(target?.split(',')[1] ?? '')).toContain('&lt;script&gt;')
    expect(decodeURIComponent(target?.split(',')[1] ?? '')).not.toContain('<script>')
    expect(mocks.show).toHaveBeenCalledOnce()
  })
})
