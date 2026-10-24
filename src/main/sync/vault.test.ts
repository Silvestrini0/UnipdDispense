import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { ManifestEntry } from './manifest'
import { renderCourseIndex, renderNote, writeNote } from './vault'

let vault: string

afterEach(async () => {
  if (vault) {
    await rm(vault, { recursive: true, force: true })
  }
})

function noteEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    key: 'nota',
    kind: 'note',
    category: 'material',
    courseId: 1,
    courseName: 'Corso',
    courseFolder: 'Corso',
    courseTag: 'corso/corso',
    sectionId: 2,
    sectionName: 'Sezione',
    sectionFolder: 'Sezione',
    moduleId: 3,
    moduleName: 'Appunti',
    moduleFolder: 'Appunti',
    filename: 'Appunti.md',
    filepath: '/',
    mimeType: 'text/markdown',
    size: 0,
    moodleAddedAt: '2024-01-01T00:00:00.000Z',
    moodleModifiedAt: '2024-01-02T00:00:00.000Z',
    sourcePath: '/pluginfile.php/1/mod_page/content/1/index.html',
    sourceUrl: 'https://example.test/pluginfile.php/1/mod_page/content/1/index.html',
    relativePath: 'Corso/Sezione/Appunti/Appunti.md',
    sidecarPath: '',
    noteType: 'page',
    noteBody: '## Contenuto\n\nTesto della pagina.',
    contentHash: 'abc',
    firstSeenAt: '2024-01-01T00:00:00.000Z',
    lastSeenAt: '2024-01-02T00:00:00.000Z',
    downloadedAt: '2024-01-02T00:00:00.000Z',
    status: 'present',
    removedDetectedAt: null,
    tags: ['moodle', 'unipd', 'corso/corso', 'page'],
    previousTags: [],
    events: [{ type: 'added', at: '2024-01-01T00:00:00.000Z' }],
    ...overrides
  }
}

describe('note del vault', () => {
  it('scrive la nota con frontmatter e corpo Markdown', async () => {
    vault = await mkdtemp(join(tmpdir(), 'unipddispense-vault-'))
    await writeNote(vault, noteEntry())
    const content = await readFile(join(vault, 'Corso/Sezione/Appunti/Appunti.md'), 'utf8')
    expect(content).toContain('moodle_type: "page"')
    expect(content).toContain('status: present')
    expect(content).toContain('# Appunti')
    expect(content).toContain('## Contenuto')
    expect(content).toContain('Testo della pagina.')
  })

  it('segnala le note rimosse senza cancellarne il contenuto', () => {
    const content = renderNote(
      noteEntry({
        status: 'removed',
        removedDetectedAt: '2024-02-01T00:00:00.000Z',
        tags: ['moodle', 'unipd', 'corso/corso', 'page', 'rimosso-da-moodle']
      })
    )
    expect(content).toContain('> [!warning] Rimosso da Moodle')
    expect(content).toContain('#rimosso-da-moodle')
    expect(content).toContain('Testo della pagina.')
  })
})

describe('indice corso', () => {
  it('separa i materiali dalle informazioni e raggruppa per sezione', () => {
    const index = renderCourseIndex(
      'Corso',
      [
        noteEntry({
          sectionFolder: '01 - Lezione 1',
          relativePath: 'Corso/Materiali/01 - Lezione 1/Appunti.md'
        }),
        noteEntry({
          key: 'orario',
          category: 'info',
          filename: 'Orario.md',
          sectionName: 'Lezione 1',
          sectionFolder: 'Lezione 1',
          relativePath: 'Corso/Informazioni/Lezione 1/Orario.md'
        })
      ],
      '2026-10-24T00:00:00.000Z'
    )
    expect(index).toContain('## Materiali\n\n### 01 - Lezione 1')
    expect(index).toContain('## Informazioni\n\n### Lezione 1')
    expect(index).toContain('[[Corso/Informazioni/Lezione 1/Orario.md|Orario.md]]')
  })
})
