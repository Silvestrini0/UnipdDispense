import { createHash } from 'node:crypto'
import type { CourseSummary } from '../../shared/types'
import type {
  MoodleContent,
  MoodleCourse,
  MoodleModule,
  MoodleSection
} from '../moodle/types'
import {
  bucketFor,
  classifyModule,
  classifySection,
  type MaterialCategory
} from './classify'
import {
  appendBeforeExtension,
  isoFromUnix,
  sanitizeSegment
} from './paths'

export type SyncItemKind = 'file' | 'note'
export type SyncNoteType = 'page' | 'book' | 'url' | 'label'

export interface SyncNotePlan {
  type: SyncNoteType
  mode: 'html' | 'inline'
  title: string
  html?: string
  externalUrl?: string
}

export interface SyncFilePlan {
  key: string
  kind: SyncItemKind
  category: MaterialCategory
  content: MoodleContent
  filename: string
  mimeType: string
  size: number
  moodleAddedAt: string | null
  moodleModifiedAt: string | null
  sourcePath: string
  sourceUrl: string
  relativePath: string
  sectionId: number
  sectionName: string
  sectionFolder: string
  moduleId: number
  moduleName: string
  moduleFolder: string
  note?: SyncNotePlan
  noteBody?: string
  contentHash?: string
}

export interface CourseSyncPlan {
  course: MoodleCourse
  courseFolder: string
  courseTag: string
  sections: number
  files: SyncFilePlan[]
}

export function toCourseSummary(course: MoodleCourse): CourseSummary {
  return {
    id: course.id,
    fullname: course.fullname,
    shortname: course.shortname,
    displayName: course.displayname || course.fullname,
    category: course.category ?? 0,
    visible: course.visible !== 0,
    startDate: course.startdate || null,
    endDate: course.enddate || null,
    summary: stripHtml(course.summary ?? '')
  }
}

export function courseFolderAssignments(courses: MoodleCourse[]): Map<number, string> {
  const assignments = new Map<number, string>()
  const used = new Set<string>()
  for (const course of courses) {
    const base = sanitizeSegment(
      course.displayname || course.fullname,
      `Corso ${course.id}`
    )
    let candidate = base
    let suffix = 1
    while (used.has(candidate.toLowerCase())) {
      suffix += 1
      candidate = `${base} (${course.id}${suffix > 2 ? `-${suffix}` : ''})`
    }
    used.add(candidate.toLowerCase())
    assignments.set(course.id, candidate)
  }
  return assignments
}

export function courseTag(course: MoodleCourse): string {
  const raw = course.shortname || course.fullname || `corso-${course.id}`
  const slug = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `corso/${slug || course.id}`
}

export function buildCoursePlan(
  course: MoodleCourse,
  sections: MoodleSection[],
  courseFolder: string,
  baseUrl: string,
  existingPathKeys: Map<string, string> = new Map()
): CourseSyncPlan {
  const base = new URL(baseUrl)
  const usedPaths = new Set<string>()
  const usedSectionNames = new Set<string>()
  const files: SyncFilePlan[] = []
  let visibleSections = 0

  const addPlan = (file: SyncFilePlan): void => {
    let relativePath = file.relativePath
    while (
      usedPaths.has(relativePath.toLowerCase()) ||
      (existingPathKeys.has(relativePath.toLowerCase()) &&
        existingPathKeys.get(relativePath.toLowerCase()) !== file.key)
    ) {
      const parts = relativePath.split('/')
      const last = parts.pop() ?? 'file'
      relativePath = `${parts.join('/')}/${appendBeforeExtension(
        last,
        ` (${file.moduleId}-${file.key.slice(0, 5)})`
      )}`
    }
    usedPaths.add(relativePath.toLowerCase())
    files.push({ ...file, relativePath })
  }

  for (const section of sections) {
    if (section.visible === 0) {
      continue
    }
    visibleSections += 1
    const sectionBase = sanitizeSegment(section.name, 'Generale')
    let sectionName = sectionBase
    let sectionSuffix = 1
    while (usedSectionNames.has(sectionName.toLowerCase())) {
      sectionSuffix += 1
      sectionName = `${sectionBase} (${section.id}${sectionSuffix > 2 ? `-${sectionSuffix}` : ''})`
    }
    usedSectionNames.add(sectionName.toLowerCase())
    const materialSectionFolder = `${String(visibleSections).padStart(2, '0')} - ${sectionName}`
    const sectionInfoContext = classifySection(section.name)
    const sectionUsedModules = new Set<string>()

    for (const module of section.modules) {
      if (module.visible === 0 || module.uservisible === false) {
        continue
      }
      const moduleBase = sanitizeSegment(module.name, `Modulo ${module.id}`)
      let moduleName = moduleBase
      let moduleSuffix = 1
      while (sectionUsedModules.has(moduleName.toLowerCase())) {
        moduleSuffix += 1
        moduleName = `${moduleBase} (${module.id}${moduleSuffix > 2 ? `-${moduleSuffix}` : ''})`
      }
      sectionUsedModules.add(moduleName.toLowerCase())

      const drafts: Array<{ plan: SyncFilePlan; subfolders: string[] }> = []
      const categoryFor = (filename: string | null | undefined): MaterialCategory =>
        classifyModule({
          modname: module.modname,
          name: module.name,
          filename,
          sectionInfoContext
        })

      if (module.modname === 'label' && module.description?.trim()) {
        const note = buildLabelNote({
          course,
          section,
          module,
          base,
          moduleName,
          category: categoryFor(null)
        })
        if (note) {
          drafts.push({ plan: note, subfolders: [] })
        }
      }

      for (const content of module.contents ?? []) {
        if (module.modname === 'url' && content.type === 'url') {
          const note = buildUrlNote({
            course,
            section,
            module,
            content,
            base,
            moduleName,
            category: categoryFor(content.filename)
          })
          if (note) {
            drafts.push({ plan: note, subfolders: [] })
          }
          continue
        }

        const note = moduleNoteForContent(module, content)
        const built = buildFilePlan({
          course,
          section,
          module,
          content,
          base,
          moduleName,
          note,
          category: categoryFor(content.filename)
        })
        if (built) {
          drafts.push(built)
        }
      }

      const groups = new Map<
        MaterialCategory,
        Array<{ plan: SyncFilePlan; subfolders: string[] }>
      >()
      for (const draft of drafts) {
        const group = groups.get(draft.plan.category)
        if (group) {
          group.push(draft)
        } else {
          groups.set(draft.plan.category, [draft])
        }
      }
      for (const [category, group] of groups) {
        const flatten = group.length === 1 && module.modname !== 'label'
        const sectionFolder = category === 'info' ? sectionName : materialSectionFolder
        for (const draft of group) {
          const parts = [
            courseFolder,
            bucketFor(category),
            sectionFolder,
            ...(flatten ? [] : [moduleName]),
            ...draft.subfolders,
            draft.plan.filename
          ]
          addPlan({ ...draft.plan, relativePath: parts.join('/'), sectionFolder })
        }
      }
    }
  }

  return {
    course,
    courseFolder,
    courseTag: courseTag(course),
    sections: visibleSections,
    files
  }
}

function moduleNoteForContent(
  module: MoodleModule,
  content: MoodleContent
): SyncNotePlan | null {
  if (content.filename.toLowerCase() !== 'index.html') {
    return null
  }
  if (module.modname === 'page') {
    return {
      type: 'page',
      mode: 'html',
      title: module.name
    }
  }
  if (module.modname === 'book') {
    const chapter = stripHtml(content.content ?? '').trim()
    return {
      type: 'book',
      mode: 'html',
      title: chapter || `Capitolo ${content.filepath.split('/').filter(Boolean)[0] ?? module.id}`
    }
  }
  return null
}

function buildLabelNote(input: {
  course: MoodleCourse
  section: MoodleSection
  module: MoodleModule
  base: URL
  moduleName: string
  category: MaterialCategory
}): SyncFilePlan | null {
  const { course, section, module, base, moduleName, category } = input
  const html = module.description?.trim()
  if (!html) {
    return null
  }
  const filename = 'Etichetta.md'
  const sourcePath = `label:${module.id}`
  return buildInlineNotePlan({
    course,
    section,
    module,
    base,
    moduleName,
    category,
    filename,
    sourcePath,
    sourceUrl: module.url ? safeUrl(module.url, base) : base.toString(),
    modifiedAt: null,
    note: {
      type: 'label',
      mode: 'inline',
      title: module.name,
      html
    }
  })
}

function buildUrlNote(input: {
  course: MoodleCourse
  section: MoodleSection
  module: MoodleModule
  content: MoodleContent
  base: URL
  moduleName: string
  category: MaterialCategory
}): SyncFilePlan | null {
  const { course, section, module, content, base, moduleName, category } = input
  if (!content.fileurl) {
    return null
  }
  let externalUrl: string
  try {
    externalUrl = safeUrl(new URL(content.fileurl, base).toString(), base)
  } catch {
    return null
  }
  const filename = `${sanitizeSegment(content.filename || module.name, 'Link')}.md`
  return buildInlineNotePlan({
    course,
    section,
    module,
    base,
    moduleName,
    category,
    filename,
    sourcePath: `url:${externalUrl}`,
    sourceUrl: safeUrl(externalUrl, base),
    modifiedAt: isoFromUnix(content.timemodified),
    note: {
      type: 'url',
      mode: 'inline',
      title: module.name,
      html: module.description,
      externalUrl
    }
  })
}

function buildInlineNotePlan(input: {
  course: MoodleCourse
  section: MoodleSection
  module: MoodleModule
  base: URL
  moduleName: string
  category: MaterialCategory
  filename: string
  sourcePath: string
  sourceUrl: string
  modifiedAt: string | null
  note: SyncNotePlan
}): SyncFilePlan {
  const {
    course,
    section,
    module,
    moduleName,
    category,
    filename,
    sourcePath,
    sourceUrl,
    modifiedAt,
    note
  } = input
  const key = createHash('sha256')
    .update(`${course.id}|${module.id}|nota|${sourcePath}`)
    .digest('hex')
    .slice(0, 24)
  return {
    key,
    kind: 'note',
    category,
    content: {
      type: note.type === 'url' ? 'url' : 'content',
      filename,
      filepath: '/',
      filesize: 0,
      fileurl: note.externalUrl,
      timemodified: undefined
    },
    filename,
    mimeType: 'text/markdown',
    size: 0,
    moodleAddedAt: null,
    moodleModifiedAt: modifiedAt,
    sourcePath,
    sourceUrl,
    relativePath: '',
    sectionId: section.id,
    sectionName: section.name,
    sectionFolder: '',
    moduleId: module.id,
    moduleName,
    moduleFolder: moduleName,
    note
  }
}

function buildFilePlan(input: {
  course: MoodleCourse
  section: MoodleSection
  module: MoodleModule
  content: MoodleContent
  base: URL
  moduleName: string
  note: SyncNotePlan | null
  category: MaterialCategory
}): { plan: SyncFilePlan; subfolders: string[] } | null {
  const { course, section, module, content, base, note, category } = input
  if (!content.fileurl || !content.filename) {
    return null
  }
  let url: URL
  try {
    url = new URL(content.fileurl, base)
  } catch {
    return null
  }
  if (url.origin !== base.origin || !url.pathname.includes('pluginfile.php')) {
    return null
  }
  const filename = note
    ? `${sanitizeSegment(note.title, 'Nota')}.md`
    : sanitizeSegment(content.filename, `file-${module.id}`)
  const subfolders = content.filepath
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => sanitizeSegment(part))
  const cleanSource = new URL(url)
  cleanSource.searchParams.delete('token')
  cleanSource.searchParams.delete('wstoken')
  const sourcePath = url.pathname
  const key = createHash('sha256')
    .update(`${course.id}|${module.id}|${sourcePath}|${content.filename}|${content.filepath}`)
    .digest('hex')
    .slice(0, 24)
  return {
    plan: {
      key,
      kind: note ? 'note' : 'file',
      category,
      content,
      filename,
      mimeType: note ? 'text/markdown' : content.mimetype || 'application/octet-stream',
      size: note ? 0 : Number(content.filesize) || 0,
      moodleAddedAt: isoFromUnix(content.timecreated),
      moodleModifiedAt: isoFromUnix(content.timemodified),
      sourcePath,
      sourceUrl: cleanSource.toString(),
      relativePath: '',
      sectionId: section.id,
      sectionName: section.name,
      sectionFolder: '',
      moduleId: module.id,
      moduleName: input.moduleName,
      moduleFolder: input.moduleName,
      note: note ?? undefined
    },
    subfolders
  }
}

function safeUrl(raw: string, base: URL): string {
  try {
    const url = new URL(raw, base)
    url.searchParams.delete('token')
    url.searchParams.delete('wstoken')
    return url.toString()
  } catch {
    return raw
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
