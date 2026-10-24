import { describe, expect, it } from 'vitest'
import {
  absoluteFromRelative,
  appendBeforeExtension,
  isoFromUnix,
  sanitizeSegment,
  shortDate
} from './paths'

describe('sanitizeSegment', () => {
  it('rimuove caratteri non validi e spazi ai bordi', () => {
    expect(sanitizeSegment('  Lezione: 01 / Intro?  ')).toBe('Lezione 01 Intro')
  })

  it('rimuove caratteri di controllo', () => {
    expect(sanitizeSegment('a\u0000b\u001fc')).toBe('a b c')
  })

  it('protegge i nomi riservati di Windows', () => {
    expect(sanitizeSegment('CON.txt')).toBe('_CON.txt')
    expect(sanitizeSegment('lpt1')).toBe('_lpt1')
  })

  it('usa un fallback e limita la lunghezza', () => {
    expect(sanitizeSegment('...')).toBe('Senza nome')
    expect(sanitizeSegment('x'.repeat(200))).toHaveLength(110)
  })
})

describe('appendBeforeExtension', () => {
  it('inserisce il suffisso prima dell’estensione', () => {
    expect(appendBeforeExtension('dispensa.pdf', ' (1)')).toBe('dispensa (1).pdf')
    expect(appendBeforeExtension('README', ' (1)')).toBe('README (1)')
    expect(appendBeforeExtension('.gitignore', ' (1)')).toBe('.gitignore (1)')
  })
})

describe('absoluteFromRelative', () => {
  it('risolve percorsi interni al vault', () => {
    expect(absoluteFromRelative('/tmp/vault', 'corso/sezione/file.pdf')).toBe(
      '/tmp/vault/corso/sezione/file.pdf'
    )
  })

  it('blocca percorsi che escono dal vault', () => {
    expect(() => absoluteFromRelative('/tmp/vault', '../fuori.pdf')).toThrow(
      'esce dal vault'
    )
  })
})

describe('date helpers', () => {
  it('converte timestamp Unix validi', () => {
    expect(isoFromUnix(0)).toBeNull()
    expect(isoFromUnix(1700000000)).toBe('2023-11-14T22:13:20.000Z')
    expect(shortDate('2023-11-14T22:13:20.000Z')).toBe('2023-11-14')
    expect(shortDate(null)).toBe('—')
  })
})
