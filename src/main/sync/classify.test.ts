import { describe, expect, it } from 'vitest'
import { classifyModule, classifySection } from './classify'

describe('classifySection', () => {
  it('riconosce le sezioni informative', () => {
    expect(classifySection('Generale')).toBe(true)
    expect(classifySection('Annunci')).toBe(true)
    expect(classifySection('Presentazione del corso')).toBe(true)
    expect(classifySection('Informazioni sul corso')).toBe(true)
  })

  it('non segnala le sezioni di lezione', () => {
    expect(classifySection('Lezione 1')).toBe(false)
    expect(classifySection('Materiale didattico')).toBe(false)
    expect(classifySection('Esercitazioni')).toBe(false)
  })
})

describe('classifyModule', () => {
  const base = { modname: 'resource', sectionInfoContext: false }

  it('mette le dispense e le lezioni nei materiali', () => {
    expect(classifyModule({ ...base, name: 'Dispensa', filename: 'dispensa.pdf' })).toBe(
      'material'
    )
    expect(classifyModule({ ...base, name: 'Slide lezione 3', filename: 'lez3.pdf' })).toBe(
      'material'
    )
    expect(classifyModule({ ...base, name: 'Esercizi', filename: 'esercizi.pdf' })).toBe(
      'material'
    )
  })

  it('mette avvisi, orari e regolamenti nelle informazioni', () => {
    expect(classifyModule({ ...base, name: 'Avviso', filename: 'avviso.pdf' })).toBe('info')
    expect(classifyModule({ ...base, name: 'Orario', filename: 'orario.pdf' })).toBe('info')
    expect(
      classifyModule({ ...base, name: 'Regolamento', filename: 'regolamento.pdf' })
    ).toBe('info')
    expect(
      classifyModule({ ...base, name: 'Modalità d’esame', filename: 'modalita.pdf' })
    ).toBe('info')
  })

  it('dà priorità ai materiali quando entrambe le euristiche coincidono', () => {
    expect(
      classifyModule({ ...base, name: 'Programma esercizi', filename: 'esercizi.pdf' })
    ).toBe('material')
    expect(
      classifyModule({ ...base, name: 'Presentazione lezione 4', filename: 'slides.pdf' })
    ).toBe('material')
  })

  it('tratta i formati multimediali e i pacchetti come materiali', () => {
    expect(classifyModule({ ...base, name: 'Registrazione', filename: 'lezione.mp4' })).toBe(
      'material'
    )
    expect(classifyModule({ ...base, name: 'Slide', filename: 'slides.pptx' })).toBe('material')
    expect(classifyModule({ ...base, name: 'Dataset', filename: 'dati.csv' })).toBe('material')
    expect(classifyModule({ ...base, name: 'Codice', filename: 'lab.py' })).toBe('material')
  })

  it('classifica etichette e link generici come informazioni', () => {
    expect(classifyModule({ ...base, name: 'Zoom aula', modname: 'url' })).toBe('info')
    expect(classifyModule({ ...base, name: 'Piattaforma', modname: 'label' })).toBe('info')
    expect(classifyModule({ ...base, name: 'Video lezione 2', modname: 'url' })).toBe('material')
  })

  it('usa il contesto della sezione per le pagine generiche', () => {
    expect(
      classifyModule({ ...base, modname: 'page', name: 'Come iscriversi', sectionInfoContext: true })
    ).toBe('info')
    expect(
      classifyModule({ ...base, modname: 'page', name: 'Widget', sectionInfoContext: true })
    ).toBe('info')
    expect(
      classifyModule({ ...base, modname: 'page', name: 'Widget', sectionInfoContext: false })
    ).toBe('material')
    expect(
      classifyModule({ ...base, modname: 'book', name: 'Manuale', sectionInfoContext: true })
    ).toBe('material')
  })

  it('per default considera tutto materiale', () => {
    expect(classifyModule({ ...base, name: 'Allegato' })).toBe('material')
  })
})
