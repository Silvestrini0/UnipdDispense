import { describe, expect, it } from 'vitest'
import type {
  MoodleContent,
  MoodleCourse,
  MoodleModule,
  MoodleSection
} from '../moodle/types'
import {
  buildCoursePlan,
  courseFolderAssignments,
  courseTag,
  toCourseSummary
} from './planner'

const baseUrl = 'https://elearning.unipd.it/dlm'

function course(overrides: Partial<MoodleCourse> = {}): MoodleCourse {
  return {
    id: 10,
    shortname: 'analisi-1',
    fullname: 'Analisi Matematica I',
    visible: 1,
    ...overrides
  }
}

function content(overrides: Partial<MoodleContent> = {}): MoodleContent {
  return {
    type: 'file',
    filename: 'dispensa.pdf',
    filepath: '/',
    filesize: 1234,
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

function section(overrides: Partial<MoodleSection> = {}): MoodleSection {
  return {
    id: 30,
    name: 'Generale',
    visible: 1,
    modules: [module()],
    ...overrides
  }
}

describe('toCourseSummary', () => {
  it('normalizza i campi e rimuove l’HTML dal sommario', () => {
    expect(
      toCourseSummary(
        course({
          displayname: 'Analisi',
          summary: '<p>Testo <strong>importante</strong></p>',
          startdate: 1700000000
        })
      )
    ).toMatchObject({
      id: 10,
      displayName: 'Analisi',
      summary: 'Testo importante',
      startDate: 1700000000,
      endDate: null
    })
  })
})

describe('courseFolderAssignments', () => {
  it('deduplica i nomi delle cartelle in modo deterministico', () => {
    const assignments = courseFolderAssignments([
      course({ id: 1, fullname: 'Analisi' }),
      course({ id: 2, fullname: 'Analisi' }),
      course({ id: 3, fullname: 'Fisica' })
    ])
    expect(assignments.get(1)).toBe('Analisi')
    expect(assignments.get(2)).toBe('Analisi (2)')
    expect(assignments.get(3)).toBe('Fisica')
  })

  it('genera il tag corso dallo shortname', () => {
    expect(courseTag(course())).toBe('corso/analisi-1')
  })
})

describe('buildCoursePlan', () => {
  it('pianifica solo file pluginfile visibili e costruisce il percorso', () => {
    const plan = buildCoursePlan(
      course(),
      [
        section(),
        section({
          id: 31,
          name: 'Nascosta',
          visible: 0,
          modules: [module({ id: 21 })]
        })
      ],
      'Analisi Matematica I',
      baseUrl
    )
    expect(plan.sections).toBe(1)
    expect(plan.files).toHaveLength(1)
    expect(plan.files[0]).toMatchObject({
      filename: 'dispensa.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      category: 'material',
      relativePath: 'Analisi Matematica I/Materiali/01 - Generale/dispensa.pdf',
      sourcePath: '/dlm/pluginfile.php/1/mod_resource/content/1/dispensa.pdf'
    })
    expect(plan.files[0]?.sourceUrl).not.toContain('token=')
  })

  it('salta moduli nascosti, file esterni e contenuti senza fileurl', () => {
    const plan = buildCoursePlan(
      course(),
      [
        section({
          modules: [
            module({ id: 40, visible: 0 }),
            module({ id: 41, uservisible: false }),
            module({
              id: 42,
              contents: [content({ fileurl: 'https://example.com/esterno.pdf' })]
            }),
            module({ id: 43, contents: [content({ fileurl: undefined })] })
          ]
        })
      ],
      'Corso',
      baseUrl
    )
    expect(plan.files).toHaveLength(0)
  })

  it('sanitizza sottocartelle e deduplica moduli con lo stesso nome', () => {
    const twoFiles = (id: number): MoodleModule =>
      module({
        id,
        contents: [content({ filename: 'a.pdf' }), content({ filename: 'b.pdf' })]
      })
    const plan = buildCoursePlan(
      course(),
      [
        section({
          modules: [
            module({
              id: 50,
              contents: [content({ filename: 'a.pdf', filepath: '/Appunti/Lezione 1/' })]
            }),
            module({ id: 51 }),
            twoFiles(52),
            twoFiles(53)
          ]
        })
      ],
      'Corso',
      baseUrl
    )
    expect(plan.files[0]?.relativePath).toBe(
      'Corso/Materiali/01 - Generale/Appunti/Lezione 1/a.pdf'
    )
    expect(plan.files[1]?.relativePath).toBe('Corso/Materiali/01 - Generale/dispensa.pdf')
    expect(plan.files[2]?.relativePath).toBe('Corso/Materiali/01 - Generale/Dispensa (52)/a.pdf')
    expect(plan.files[4]?.relativePath).toBe('Corso/Materiali/01 - Generale/Dispensa (53)/a.pdf')
  })

  it('tiene la cartella del modulo quando contiene più file', () => {
    const plan = buildCoursePlan(
      course(),
      [
        section({
          modules: [
            module({
              id: 80,
              name: 'Materiale',
              contents: [content({ filename: 'uno.pdf' }), content({ filename: 'due.pdf' })]
            })
          ]
        })
      ],
      'Corso',
      baseUrl
    )
    expect(plan.files.map((file) => file.relativePath)).toEqual([
      'Corso/Materiali/01 - Generale/Materiale/uno.pdf',
      'Corso/Materiali/01 - Generale/Materiale/due.pdf'
    ])
  })

  it('separa i file informativi dai materiali', () => {
    const plan = buildCoursePlan(
      course(),
      [
        section({
          id: 35,
          name: 'Lezione 1',
          modules: [
            module({
              id: 70,
              name: 'Orario',
              contents: [content({ filename: 'orario.pdf' })]
            }),
            module({
              id: 71,
              name: 'Dispensa 1',
              contents: [content({ filename: 'dispensa1.pdf' })]
            })
          ]
        })
      ],
      'Corso',
      baseUrl
    )
    expect(plan.files[0]).toMatchObject({
      category: 'info',
      relativePath: 'Corso/Informazioni/Lezione 1/orario.pdf'
    })
    expect(plan.files[1]).toMatchObject({
      category: 'material',
      relativePath: 'Corso/Materiali/01 - Lezione 1/dispensa1.pdf'
    })
  })

  it('numera le sezioni visibili in ordine, saltando le nascoste', () => {
    const plan = buildCoursePlan(
      course(),
      [
        section({ id: 30, name: 'Generale', modules: [] }),
        section({
          id: 31,
          name: 'Nascosta',
          visible: 0,
          modules: [module({ id: 21, contents: [content({ filename: 'nascosto.pdf' })] })]
        }),
        section({
          id: 32,
          name: 'Lezione 1',
          modules: [module({ id: 22, contents: [content({ filename: 'l1.pdf' })] })]
        }),
        section({
          id: 33,
          name: 'Lezione 2',
          modules: [module({ id: 23, contents: [content({ filename: 'l2.pdf' })] })]
        })
      ],
      'Corso',
      baseUrl
    )
    expect(plan.files.map((file) => file.relativePath)).toEqual([
      'Corso/Materiali/02 - Lezione 1/l1.pdf',
      'Corso/Materiali/03 - Lezione 2/l2.pdf'
    ])
  })

  it('aggiunge un suffisso se il percorso è occupato da un file diverso', () => {
    const first = buildCoursePlan(course(), [section()], 'Corso', baseUrl)
    const path = first.files[0]?.relativePath
    expect(path).toBeTruthy()
    const occupied = new Map([[path?.toLowerCase() ?? '', 'altra-chiave']])
    const plan = buildCoursePlan(course(), [section()], 'Corso', baseUrl, occupied)
    expect(plan.files[0]?.relativePath).not.toBe(path)
    expect(plan.files[0]?.relativePath).toContain('dispensa (20-')
  })

  it('trasforma pagine e capitoli dei libri in note Markdown', () => {
    const plan = buildCoursePlan(
      course(),
      [
        section({
          modules: [
            module({
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
            }),
            module({
              id: 61,
              name: 'Manuale',
              modname: 'book',
              contents: [
                content({
                  type: 'content',
                  filename: 'structure',
                  fileurl: undefined
                }),
                content({
                  filename: 'index.html',
                  filepath: '/77/',
                  content: 'Capitolo 1',
                  fileurl: `${baseUrl}/pluginfile.php/1/mod_book/content/1/77/index.html`
                })
              ]
            })
          ]
        })
      ],
      'Corso',
      baseUrl
    )
    expect(plan.files).toHaveLength(2)
    expect(plan.files[0]).toMatchObject({
      kind: 'note',
      filename: 'Appunti.md',
      mimeType: 'text/markdown',
      category: 'material',
      relativePath: 'Corso/Materiali/01 - Generale/Appunti.md',
      note: { type: 'page', mode: 'html', title: 'Appunti' }
    })
    expect(plan.files[1]).toMatchObject({
      kind: 'note',
      filename: 'Capitolo 1.md',
      category: 'material',
      relativePath: 'Corso/Materiali/01 - Generale/77/Capitolo 1.md',
      note: { type: 'book', mode: 'html', title: 'Capitolo 1' }
    })
  })

  it('crea una nota per i moduli URL senza scaricare il link esterno', () => {
    const plan = buildCoursePlan(
      course(),
      [
        section({
          modules: [
            module({
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
          ]
        })
      ],
      'Corso',
      baseUrl
    )
    expect(plan.files).toHaveLength(1)
    expect(plan.files[0]).toMatchObject({
      kind: 'note',
      filename: 'Video lezione.md',
      category: 'material',
      relativePath: 'Corso/Materiali/01 - Generale/Video lezione.md',
      sourceUrl: 'https://example.com/video',
      note: {
        type: 'url',
        mode: 'inline',
        externalUrl: 'https://example.com/video',
        html: '<p>Guarda il video</p>'
      }
    })
  })

  it('crea una nota per le etichette usando la descrizione del modulo', () => {
    const plan = buildCoursePlan(
      course(),
      [
        section({
          modules: [
            module({
              id: 63,
              name: 'Avviso',
              modname: 'label',
              description: '<p>Benvenuti nel corso</p>',
              contents: []
            })
          ]
        })
      ],
      'Corso',
      baseUrl
    )
    expect(plan.files).toHaveLength(1)
    expect(plan.files[0]).toMatchObject({
      kind: 'note',
      filename: 'Etichetta.md',
      category: 'info',
      relativePath: 'Corso/Informazioni/Generale/Avviso/Etichetta.md',
      note: {
        type: 'label',
        mode: 'inline',
        title: 'Avviso',
        html: '<p>Benvenuti nel corso</p>'
      }
    })
  })
})
