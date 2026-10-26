import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ManifestEntry } from './manifest'
import { absoluteFromRelative, shortDate } from './paths'

const SIDECAR_ROOT = 'Schede file'

export function sidecarPathFor(relativePath: string): string {
  return `${SIDECAR_ROOT}/${relativePath}.md`
}

export async function writeSidecar(vaultPath: string, entry: ManifestEntry): Promise<void> {
  const target = absoluteFromRelative(vaultPath, entry.sidecarPath)
  await mkdir(dirname(target), { recursive: true })
  await writeIfChanged(target, renderSidecar(entry))
}

export async function writeNote(vaultPath: string, entry: ManifestEntry): Promise<void> {
  const target = absoluteFromRelative(vaultPath, entry.relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeIfChanged(target, renderNote(entry))
}

export async function writeCourseIndexes(
  vaultPath: string,
  entries: ManifestEntry[]
): Promise<void> {
  if (entries.length === 0) {
    return
  }
  const first = entries[0]
  if (!first) {
    return
  }
  const sorted = [...entries].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, 'it', { sensitivity: 'base' })
  )
  const removed = sorted.filter((entry) => entry.status === 'removed')
  const indexTarget = absoluteFromRelative(vaultPath, `${first.courseFolder}/Indice corso.md`)
  const removedTarget = absoluteFromRelative(
    vaultPath,
    `${first.courseFolder}/Rimossi da Moodle.md`
  )
  await mkdir(dirname(indexTarget), { recursive: true })
  await writeIfChanged(
    indexTarget,
    renderCourseIndex(first.courseName, sorted, new Date().toISOString())
  )
  await writeIfChanged(
    removedTarget,
    renderRemovedIndex(first.courseName, removed, new Date().toISOString())
  )
}

export async function sidecarExists(vaultPath: string, entry: ManifestEntry): Promise<boolean> {
  try {
    await access(absoluteFromRelative(vaultPath, entry.sidecarPath))
    return true
  } catch {
    return false
  }
}

export async function removeSidecar(vaultPath: string, sidecarPath: string): Promise<void> {
  try {
    const target = absoluteFromRelative(vaultPath, sidecarPath)
    await unlink(target)
  } catch {
    return
  }
}

export function renderNote(entry: ManifestEntry): string {
  const title = entry.filename.replace(/\.md$/i, '')
  const tags = entry.tags.map((tag) => `  - ${yamlValue(tag)}`).join('\n')
  const previousTags =
    entry.previousTags.length > 0
      ? `\nprevious_tags:\n${entry.previousTags.map((tag) => `  - ${yamlValue(tag)}`).join('\n')}`
      : ''
  const removed =
    entry.status === 'removed'
      ? `\n> [!warning] Rimosso da Moodle\n> Questo contenuto non è più presente su Moodle dal ${shortDate(entry.removedDetectedAt)}. La nota locale è stata conservata.\n\n#rimosso-da-moodle\n`
      : ''
  const history =
    entry.events.length > 0
      ? entry.events
          .map((event) => `- ${shortDate(event.at)} — ${eventLabel(event.type)}`)
          .join('\n')
      : '- Nessun evento registrato.'
  const body = entry.noteBody?.trim() ?? ''
  return `---
moodle_key: ${yamlValue(entry.key)}
course_id: ${entry.courseId}
course: ${yamlValue(entry.courseName)}
section: ${yamlValue(entry.sectionName)}
module: ${yamlValue(entry.moduleName)}
moodle_type: ${yamlValue(entry.noteType ?? 'nota')}
category: ${entry.category}
source: ${yamlValue(entry.sourceUrl)}
moodle_added: ${yamlValue(entry.moodleAddedAt)}
moodle_modified: ${yamlValue(entry.moodleModifiedAt)}
first_seen: ${yamlValue(entry.firstSeenAt)}
last_seen: ${yamlValue(entry.lastSeenAt)}
downloaded: ${yamlValue(entry.downloadedAt)}
status: ${entry.status}
removed_detected: ${yamlValue(entry.removedDetectedAt)}
tags:
${tags}${previousTags}
---

# ${title}
${removed ? removed : ''}
${body}

## Cronologia

${history}
`
}

export function renderSidecar(entry: ManifestEntry): string {
  const tags = entry.tags.map((tag) => `  - ${yamlValue(tag)}`).join('\n')
  const previousTags =
    entry.previousTags.length > 0
      ? `\nprevious_tags:\n${entry.previousTags.map((tag) => `  - ${yamlValue(tag)}`).join('\n')}`
      : ''
  const removed =
    entry.status === 'removed'
      ? `\n> [!warning] Rimosso da Moodle\n> Questo file non è più presente su Moodle dal ${shortDate(entry.removedDetectedAt)}. La copia locale è stata conservata.\n\n#rimosso-da-moodle\n`
      : ''
  const history =
    entry.events.length > 0
      ? entry.events
          .map((event) => `- ${shortDate(event.at)} — ${eventLabel(event.type)}`)
          .join('\n')
      : '- Nessun evento registrato.'
  return `---
moodle_key: ${yamlValue(entry.key)}
course_id: ${entry.courseId}
course: ${yamlValue(entry.courseName)}
section: ${yamlValue(entry.sectionName)}
module: ${yamlValue(entry.moduleName)}
file: ${yamlValue(entry.filename)}
mime_type: ${yamlValue(entry.mimeType)}
category: ${entry.category}
size: ${entry.size}
moodle_added: ${yamlValue(entry.moodleAddedAt)}
moodle_modified: ${yamlValue(entry.moodleModifiedAt)}
first_seen: ${yamlValue(entry.firstSeenAt)}
last_seen: ${yamlValue(entry.lastSeenAt)}
downloaded: ${yamlValue(entry.downloadedAt)}
status: ${entry.status}
removed_detected: ${yamlValue(entry.removedDetectedAt)}
source: ${yamlValue(entry.sourceUrl)}
tags:
${tags}${previousTags}
---

# ${entry.filename}

- Corso: ${entry.courseName}
- Sezione: ${entry.sectionName}
- Modulo: ${entry.moduleName}
- Percorso: \`${entry.relativePath}\`
- Origine: <${entry.sourceUrl}>
${removed}
## Cronologia

${history}
`
}

export function renderCourseIndex(
  courseName: string,
  entries: ManifestEntry[],
  generatedAt: string
): string {
  const present = entries.filter((entry) => entry.status === 'present').length
  const material = entries.filter((entry) => entry.category !== 'info')
  const info = entries.filter((entry) => entry.category === 'info')
  return `---
type: indice-moodle
course: ${yamlValue(courseName)}
tags:
  - moodle
  - unipd
---

# ${courseName}

> [!info] Sincronizzato da UnipdDispense
> ${shortDate(generatedAt)} · ${present} file presenti · ${
    entries.length - present
  } rimossi

## Materiali

${renderCategoryBlock(material, 'Nessun materiale sincronizzato.')}

## Informazioni

${renderCategoryBlock(info, 'Nessuna informazione di corso.')}

Vedi anche [[Rimossi da Moodle]].
`
}

function renderCategoryBlock(entries: ManifestEntry[], emptyMessage: string): string {
  if (entries.length === 0) {
    return `_${emptyMessage}_`
  }
  const groups = new Map<string, ManifestEntry[]>()
  for (const entry of entries) {
    const key = entry.sectionFolder || entry.sectionName || 'Senza sezione'
    const group = groups.get(key)
    if (group) {
      group.push(entry)
    } else {
      groups.set(key, [entry])
    }
  }
  const sectionNames = [...groups.keys()].sort((left, right) =>
    left.localeCompare(right, 'it', { numeric: true, sensitivity: 'base' })
  )
  return sectionNames
    .map((sectionName) => {
      const sectionEntries = [...(groups.get(sectionName) ?? [])].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath, 'it', { sensitivity: 'base' })
      )
      const lines = sectionEntries
        .map((entry) => {
          const label = escapeCell(entry.filename)
          const state =
            entry.status === 'removed'
              ? `**Rimosso** dal ${shortDate(entry.removedDetectedAt)}`
              : `modificato ${shortDate(entry.moodleModifiedAt)}`
          return `- [[${entry.relativePath}|${label}]] — ${state}`
        })
        .join('\n')
      return `### ${sectionName}\n\n${lines}`
    })
    .join('\n\n')
}

function renderRemovedIndex(
  courseName: string,
  entries: ManifestEntry[],
  generatedAt: string
): string {
  const rows =
    entries.length > 0
      ? entries
          .map(
            (entry) =>
              `| [[${entry.relativePath}]] | ${escapeCell(entry.sectionName)} | ${escapeCell(
                entry.moduleName
              )} | ${shortDate(entry.removedDetectedAt)} |`
          )
          .join('\n')
      : '| — | — | — | — |'
  return `---
type: rimossi-moodle
course: ${yamlValue(courseName)}
tags:
  - moodle
  - unipd
  - rimosso-da-moodle
---

# Rimossi da Moodle — ${courseName}

> [!warning]
> I file elencati non sono più presenti su Moodle ma restano nel vault. Aggiornato il ${shortDate(
    generatedAt
  )}.

| File | Sezione | Modulo | Rimosso il |
|---|---|---|---|
${rows}
`
}

function eventLabel(type: ManifestEntry['events'][number]['type']): string {
  switch (type) {
    case 'added':
      return 'Aggiunto'
    case 'removed':
      return 'Rimosso da Moodle'
    case 'restored':
      return 'Riaggiunto su Moodle'
  }
}

function yamlValue(value: string | null): string {
  if (value === null) {
    return 'null'
  }
  return JSON.stringify(value)
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

async function writeIfChanged(target: string, content: string): Promise<void> {
  const existing = await readFile(target, 'utf8').catch(() => null)
  if (existing === content) {
    return
  }
  await mkdir(dirname(target), { recursive: true })
  const temporaryPath = `${target}.unipddispense-write.tmp`
  try {
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, target)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}
