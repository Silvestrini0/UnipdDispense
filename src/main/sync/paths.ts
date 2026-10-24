import { isAbsolute, relative, resolve, sep } from 'node:path'

const INVALID_SEGMENT_CHARS = /[\p{Cc}<>:"/\\|?*#[\]^]/gu
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function sanitizeSegment(value: string, fallback = 'Senza nome'): string {
  let result = value
    .normalize('NFC')
    .replace(INVALID_SEGMENT_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '')
    .replace(/[. ]+$/g, '')
  if (!result) {
    result = fallback
  }
  if (result.length > 110) {
    result = result.slice(0, 110).trim()
  }
  if (WINDOWS_RESERVED_NAMES.test(result)) {
    result = `_${result}`
  }
  return result
}

export function appendBeforeExtension(filename: string, suffix: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot <= 0) {
    return `${filename}${suffix}`
  }
  return `${filename.slice(0, lastDot)}${suffix}${filename.slice(lastDot)}`
}

export function absoluteFromRelative(root: string, relativePath: string): string {
  const rootPath = resolve(root)
  const target = resolve(rootPath, ...relativePath.split('/'))
  const relation = relative(rootPath, target)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('Il percorso del file esce dal vault configurato.')
  }
  return target
}

export function ensureTrailingSeparator(value: string): string {
  return value.endsWith(sep) ? value : `${value}${sep}`
}

export function isoFromUnix(value: number | undefined | null): string | null {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return new Date(value * 1000).toISOString()
}

export function shortDate(value: string | null): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return date.toISOString().slice(0, 10)
}
