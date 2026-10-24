import type { SyncPhase } from '../../shared/types'

export function formatDateTime(value: string | null): string {
  if (!value) {
    return 'Mai'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Mai'
  }
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

export function formatUnixDate(value: number | null): string {
  if (!value) {
    return '—'
  }
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(
    new Date(value * 1000)
  )
}

export function formatFileSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let unit = units[0] ?? 'KB'
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024
    unit = units[index] ?? unit
  }
  return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(size)} ${unit}`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function phaseLabel(phase: SyncPhase): string {
  switch (phase) {
    case 'idle':
      return 'In attesa'
    case 'scanning':
      return 'Analisi dei corsi'
    case 'downloading':
      return 'Download dei materiali'
    case 'finalizing':
      return 'Schede e indici'
    case 'completed':
      return 'Completata'
    case 'error':
      return 'Errore'
  }
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function secureStorageLabel(
  state: 'secure' | 'basic-text' | 'unavailable'
): string {
  switch (state) {
    case 'secure':
      return 'Portachiavi di sistema'
    case 'basic-text':
      return 'Archivio locale'
    case 'unavailable':
      return 'Portachiavi non disponibile'
  }
}

export function courseColor(id: number): string {
  const palette = ['#2563eb', '#0f766e', '#9333ea', '#c2410c', '#0369a1', '#be123c']
  return palette[id % palette.length] ?? '#2563eb'
}
