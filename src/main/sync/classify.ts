export type MaterialCategory = 'material' | 'info'

export const MATERIAL_BUCKET = 'Materiali'
export const INFO_BUCKET = 'Informazioni'

const MATERIAL_EXTENSIONS = new Set([
  'ppt',
  'pptx',
  'odp',
  'mp4',
  'm4v',
  'mov',
  'webm',
  'mkv',
  'avi',
  'mp3',
  'm4a',
  'wav',
  'ogg',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'tgz',
  'ipynb',
  'py',
  'c',
  'h',
  'cpp',
  'cc',
  'java',
  'js',
  'ts',
  'r',
  'm',
  'tex',
  'bib',
  'sql',
  'csv',
  'xlsx',
  'ods',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff'
])

const MATERIAL_PATTERNS: RegExp[] = [
  /lezion/,
  /slide/,
  /dispens/,
  /appunt/,
  /esercizi/,
  /esercitazion/,
  /laborator/,
  /\blab\b/,
  /tutorial/,
  /video/,
  /registrazion/,
  /capitol/,
  /formulario|formulari/,
  /simulazion/,
  /schema|schemi/,
  /riassunt/,
  /\bnote\b/,
  /compit/,
  /prova|prove/,
  /svolgiment|soluzion/,
  /approfondiment/,
  /materiale|materiali/,
  /raccolt/,
  /past.?exam|vecchi esami|temi d.?esame|\btema\b|\btemi\b/,
  /manuale|manuali/,
  /paniere/,
  /libro|libri/
]

const INFO_PATTERNS: RegExp[] = [
  /avvis|annunc/,
  /orario|calendario|\baula\b|\bturni?\b|frequenza/,
  /programma|syllabus|obiettiv|risultat|esiti|valutazion|criteri|modalit|regolament|indicazion/,
  /presentazion|benvenut|chi sono|il docente|introduzione al corso|welcome/,
  /ricevimento|contatt|supporto|assistenza|\bhelp\b|\bfaq\b|tutorato|reclami|segreteria/,
  /\bbando\b|iscrizion|requisit|propedeutic/,
  /appell|esonero|sessione d.?esame|date d.?esame|prenotazion/,
  /informazion|comunicazion/,
  /\bguida\b|istruzion/
]

const INFO_SECTION_PATTERNS: RegExp[] = [
  /generale/,
  /annunci|avvisi/,
  /comunicazion|informazion/,
  /benvenut|presentazion|welcome/,
  /bacheca|\bnews\b|notizie/,
  /\bvarie\b/
]

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function matches(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.')
  if (index <= 0) {
    return ''
  }
  return filename.slice(index + 1).toLowerCase()
}

export function classifySection(name: string): boolean {
  return matches(INFO_SECTION_PATTERNS, normalize(name))
}

export interface ModuleClassificationInput {
  modname: string
  name: string
  filename?: string | null
  sectionInfoContext: boolean
}

export function classifyModule(input: ModuleClassificationInput): MaterialCategory {
  const { modname, name, filename, sectionInfoContext } = input
  if (filename && MATERIAL_EXTENSIONS.has(extensionOf(filename))) {
    return 'material'
  }
  const subject = normalize(`${name} ${filename ?? ''}`)
  if (matches(MATERIAL_PATTERNS, subject)) {
    return 'material'
  }
  if (matches(INFO_PATTERNS, subject)) {
    return 'info'
  }
  if (modname === 'label' || modname === 'url') {
    return 'info'
  }
  if (sectionInfoContext && modname === 'page') {
    return 'info'
  }
  return 'material'
}

export function bucketFor(category: MaterialCategory): string {
  return category === 'info' ? INFO_BUCKET : MATERIAL_BUCKET
}
