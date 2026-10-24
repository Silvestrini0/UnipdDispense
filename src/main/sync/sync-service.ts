import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  utimes
} from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  AppSettings,
  SyncOptions,
  SyncProgress,
  SyncResult
} from '../../shared/types'
import { AuthService } from '../auth/auth-service'
import { errorMessage, logger, sanitizeUrl } from '../logger'
import { MoodleApi, MoodleApiError } from '../moodle/api'
import { SettingsStore } from '../settings-store'
import {
  buildCoursePlan,
  courseFolderAssignments,
  type CourseSyncPlan,
  type SyncFilePlan
} from './planner'
import {
  ManifestStore,
  type ManifestEntry,
  type SyncManifest
} from './manifest'
import { absoluteFromRelative, shortDate } from './paths'
import { htmlToMarkdown } from './markdown'
import {
  removeSidecar,
  sidecarExists,
  sidecarPathFor,
  writeCourseIndexes,
  writeNote,
  writeSidecar
} from './vault'

function initialProgress(): SyncProgress {
  return {
    running: false,
    phase: 'idle',
    message: 'Pronto.',
    courseId: null,
    courseName: null,
    currentFile: null,
    processed: 0,
    total: 0,
    downloaded: 0,
    skipped: 0,
    removed: 0,
    errors: 0,
    startedAt: null,
    finishedAt: null
  }
}

type ProgressListener = (progress: SyncProgress) => void

export class SyncService {
  private state: SyncProgress = initialProgress()
  private runPromise: Promise<SyncResult> | null = null
  private readonly listeners = new Set<ProgressListener>()

  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsStore
  ) {}

  getProgress(): SyncProgress {
    return structuredClone(this.state)
  }

  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(options: SyncOptions = {}): Promise<SyncResult> {
    if (this.runPromise) {
      return this.runPromise
    }
    this.runPromise = this.run(options).finally(() => {
      this.runPromise = null
    })
    return this.runPromise
  }

  private async run(options: SyncOptions): Promise<SyncResult> {
    const startedAt = new Date().toISOString()
    this.update({
      ...initialProgress(),
      running: true,
      phase: 'scanning',
      message: 'Connessione a Moodle…',
      startedAt
    })
    try {
      const result = await this.execute(options)
      await this.settings.update({ lastSyncAt: result.finishedAt }).catch((error) => {
        logger.warn('Impossibile salvare lastSyncAt:', errorMessage(error))
      })
      this.update({
        running: false,
        phase: 'completed',
        message: `Sincronizzazione completata: ${result.downloaded} scaricati, ${result.skipped} invariati, ${result.removed} rimossi${result.errors.length > 0 ? `, ${result.errors.length} errori` : ''}.`,
        currentFile: null,
        finishedAt: result.finishedAt
      })
      return result
    } catch (error) {
      this.update({
        running: false,
        phase: 'error',
        message: errorMessage(error),
        courseId: null,
        courseName: null,
        currentFile: null,
        finishedAt: new Date().toISOString()
      })
      throw error
    }
  }

  private async execute(options: SyncOptions): Promise<SyncResult> {
    const settings = this.settings.get()
    const vaultPath = resolve(settings.vaultPath)
    await mkdir(vaultPath, { recursive: true })
    return this.auth.withApi((api) =>
      this.syncWithApi(api, vaultPath, settings, options)
    )
  }

  private async syncWithApi(
    api: MoodleApi,
    vaultPath: string,
    settings: AppSettings,
    options: SyncOptions
  ): Promise<SyncResult> {
    const siteInfo = await api.getSiteInfo()
    const hasEnrolFunction = Array.isArray(siteInfo.functions)
      ? siteInfo.functions.some((fn) => fn.name === 'core_enrol_get_users_courses')
      : null
    logger.info(
      `Moodle: utente ${siteInfo.username} (id ${siteInfo.userid}), sito ${siteInfo.sitename}${siteInfo.release ? ` ${siteInfo.release}` : ''}.`
    )
    logger.info(
      `Moodle: ${siteInfo.functions?.length ?? 0} funzioni disponibili; core_enrol_get_users_courses: ${hasEnrolFunction === null ? 'n/d' : hasEnrolFunction ? 'sì' : 'no'}.`
    )
    const siteUrl = siteInfo.siteurl || 'https://elearning.unipd.it/dlm'
    const allCourses = await api.getUsersCourses(siteInfo.userid)
    logger.info(`Moodle: ${allCourses.length} corsi iscritti.`)
    const firstCourse = allCourses[0]
    if (firstCourse) {
      logger.info(
        `Moodle: primo corso ${firstCourse.id} «${firstCourse.fullname}» (visibile: ${firstCourse.visible}).`
      )
    }
    const selectedIds =
      options.courseIds !== undefined
        ? new Set(options.courseIds)
        : settings.syncAllCourses
          ? null
          : new Set(settings.selectedCourseIds)
    const courses =
      selectedIds === null
        ? allCourses
        : allCourses.filter((course) => selectedIds.has(course.id))
    courses.sort((left, right) =>
      (left.displayname || left.fullname).localeCompare(
        right.displayname || right.fullname,
        'it',
        { sensitivity: 'base' }
      )
    )

    const manifestStore = new ManifestStore(vaultPath)
    const manifest = await manifestStore.load()
    const folderAssignments = courseFolderAssignments(courses)
    const prepared: CourseSyncPlan[] = []
    const errors: SyncResult['errors'] = []
    let total = 0
    let processed = 0
    let downloaded = 0
    let skipped = 0
    let removed = 0

    for (const course of courses) {
      this.update({
        phase: 'scanning',
        courseId: course.id,
        courseName: course.displayname || course.fullname,
        message: `Analisi di ${course.displayname || course.fullname}…`
      })
      try {
        const sections = await api.getCourseContents(course.id)
        const courseFolder = folderAssignments.get(course.id) ?? `Corso ${course.id}`
        const existingPathKeys = await existingPathKeysForCourse(
          manifest,
          course.id,
          vaultPath,
          courseFolder
        )
        const plan = buildCoursePlan(
          course,
          sections,
          courseFolder,
          siteUrl,
          existingPathKeys
        )
        prepared.push(plan)
        total += plan.files.length
        this.update({
          total,
          message: `${course.displayname || course.fullname}: ${plan.files.length} file trovati.`
        })
      } catch (error) {
        if (isAuthenticationError(error)) {
          throw error
        }
        errors.push({
          path: course.displayname || course.fullname,
          message: errorMessage(error)
        })
        this.update({ errors: errors.length })
        logger.warn(`Analisi corso ${course.id} non riuscita:`, errorMessage(error))
      }
    }

    this.update({
      phase: 'downloading',
      message: 'Download dei materiali…',
      courseId: null,
      courseName: null,
      currentFile: null,
      total
    })

    const changedKeys = new Set<string>()

    for (const plan of prepared) {
      const courseName = plan.course.displayname || plan.course.fullname
      this.update({
        courseId: plan.course.id,
        courseName,
        message: `Sincronizzazione di ${courseName}…`
      })
      for (const file of plan.files) {
        this.update({ currentFile: file.relativePath })
        try {
          const existing = manifest.entries[file.key]
          const now = new Date().toISOString()
          if (file.note?.mode === 'inline') {
            file.noteBody = this.renderInlineNote(file, siteUrl)
            file.contentHash = noteContentHash(file) ?? undefined
          }
          const moved =
            existing !== undefined &&
            existing.relativePath !== file.relativePath &&
            (await this.moveExisting(vaultPath, existing, file))
          if (moved && existing) {
            skipped += 1
            manifest.entries[file.key] = this.buildEntry(
              plan,
              file,
              existing,
              now,
              existing.downloadedAt,
              false
            )
            changedKeys.add(file.key)
          } else if (await this.canSkip(vaultPath, file, existing)) {
            skipped += 1
            if (file.kind === 'note' && !file.noteBody) {
              file.noteBody = existing?.noteBody ?? undefined
            }
            manifest.entries[file.key] = this.buildEntry(
              plan,
              file,
              existing,
              now,
              existing?.downloadedAt ?? now,
              false
            )
          } else {
            let entry: ManifestEntry
            if (file.kind === 'note') {
              if (file.note?.mode === 'html') {
                file.noteBody = await this.fetchHtmlNote(api, file, siteUrl)
                file.contentHash = noteContentHash(file) ?? undefined
              }
              entry = this.buildEntry(plan, file, existing, now, now, true)
              await writeNote(vaultPath, entry)
            } else {
              await this.downloadFile(api, vaultPath, file)
              entry = this.buildEntry(plan, file, existing, now, now, true)
            }
            downloaded += 1
            manifest.entries[file.key] = entry
            changedKeys.add(file.key)
            if (existing && existing.relativePath !== entry.relativePath) {
              await this.removeMovedFile(vaultPath, existing)
            }
          }
          processed += 1
          this.update({
            processed,
            downloaded,
            skipped,
            errors: errors.length
          })
        } catch (error) {
          if (isAuthenticationError(error)) {
            throw error
          }
          processed += 1
          errors.push({ path: file.relativePath, message: errorMessage(error) })
          this.update({ processed, errors: errors.length })
          logger.warn(`Download non riuscito ${sanitizeUrl(file.sourceUrl)}:`, errorMessage(error))
        }
      }

      const newlyRemoved = markRemovedFiles(
        manifest,
        plan,
        new Date().toISOString(),
        changedKeys
      )
      removed += newlyRemoved
      this.update({ removed, currentFile: null, errors: errors.length })
      await manifestStore.save(manifest)
    }

    this.update({
      phase: 'finalizing',
      message: 'Aggiornamento di schede e indici…',
      courseId: null,
      courseName: null,
      currentFile: null
    })

    const preparedIds = new Set(prepared.map((plan) => plan.course.id))
    for (const entry of Object.values(manifest.entries)) {
      if (!preparedIds.has(entry.courseId)) {
        continue
      }
      if (entry.kind === 'note') {
        if (!changedKeys.has(entry.key)) {
          continue
        }
        try {
          await writeNote(vaultPath, entry)
        } catch (error) {
          errors.push({
            path: entry.relativePath,
            message: `Nota non aggiornata: ${errorMessage(error)}`
          })
        }
        continue
      }
      if (changedKeys.has(entry.key) || !(await sidecarExists(vaultPath, entry))) {
        try {
          await writeSidecar(vaultPath, entry)
        } catch (error) {
          errors.push({
            path: entry.sidecarPath,
            message: `Scheda non aggiornata: ${errorMessage(error)}`
          })
        }
      }
    }
    for (const plan of prepared) {
      const courseEntries = Object.values(manifest.entries).filter(
        (entry) => entry.courseId === plan.course.id
      )
      try {
        await writeCourseIndexes(vaultPath, courseEntries)
      } catch (error) {
        errors.push({
          path: plan.courseFolder,
          message: `Indice non aggiornato: ${errorMessage(error)}`
        })
      }
    }
    await manifestStore.save(manifest)

    const finishedAt = new Date().toISOString()
    this.update({ errors: errors.length })
    logger.info(
      `Sync completata: ${prepared.length} corsi, ${downloaded} scaricati, ${skipped} invariati, ${removed} rimossi, ${errors.length} errori (${shortDate(finishedAt)}).`
    )
    return {
      downloaded,
      skipped,
      removed,
      errors,
      courses: prepared.length,
      finishedAt
    }
  }

  private renderInlineNote(file: SyncFilePlan, baseUrl: string): string {
    const note = file.note
    if (!note) {
      return ''
    }
    const sections: string[] = []
    if (note.externalUrl) {
      sections.push(`[Apri risorsa](<${note.externalUrl}>)`)
    }
    if (note.html?.trim()) {
      const markdown = htmlToMarkdown(note.html, baseUrl).trim()
      if (markdown) {
        sections.push(markdown)
      }
    }
    return sections.join('\n\n').trim()
  }

  private async fetchHtmlNote(
    api: MoodleApi,
    file: SyncFilePlan,
    baseUrl: string
  ): Promise<string> {
    if (!file.content.fileurl) {
      throw new Error('URL del contenuto assente.')
    }
    const response = await api.fetchFile(file.content.fileurl)
    return htmlToMarkdown(await response.text(), baseUrl)
  }

  private async canSkip(
    vaultPath: string,
    file: SyncFilePlan,
    existing: ManifestEntry | undefined
  ): Promise<boolean> {
    if (
      !existing ||
      existing.kind !== file.kind ||
      existing.status !== 'present' ||
      existing.relativePath !== file.relativePath ||
      existing.moodleModifiedAt !== file.moodleModifiedAt ||
      existing.sourcePath !== file.sourcePath
    ) {
      return false
    }
    let localSize: number
    try {
      const info = await stat(absoluteFromRelative(vaultPath, file.relativePath))
      if (!info.isFile()) {
        return false
      }
      localSize = info.size
    } catch {
      return false
    }
    if (file.kind === 'note') {
      if (file.note?.mode === 'inline') {
        return Boolean(file.contentHash) && existing.contentHash === file.contentHash
      }
      return Boolean(file.moodleModifiedAt)
    }
    if (existing.size !== file.size) {
      return false
    }
    return file.size <= 0 || localSize === file.size
  }

  private async moveExisting(
    vaultPath: string,
    existing: ManifestEntry,
    file: SyncFilePlan
  ): Promise<boolean> {
    if (!(await this.canRelocate(vaultPath, existing, file))) {
      return false
    }
    try {
      const source = absoluteFromRelative(vaultPath, existing.relativePath)
      const target = absoluteFromRelative(vaultPath, file.relativePath)
      try {
        await stat(target)
        throw new Error(`Percorso di destinazione già occupato: ${file.relativePath}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await mkdir(dirname(target), { recursive: true })
      await rename(source, target)
      if (existing.sidecarPath) {
        const previousSidecar = absoluteFromRelative(vaultPath, existing.sidecarPath)
        const nextSidecar = absoluteFromRelative(vaultPath, sidecarPathFor(file.relativePath))
        await mkdir(dirname(nextSidecar), { recursive: true })
        await rename(previousSidecar, nextSidecar).catch(() => undefined)
      }
      logger.debug(`File spostato: ${existing.relativePath} → ${file.relativePath}`)
      return true
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('Percorso di destinazione già occupato:')
      ) {
        throw error
      }
      logger.debug(
        `Spostamento non riuscito (${existing.relativePath} → ${file.relativePath}):`,
        errorMessage(error)
      )
      return false
    }
  }

  private async canRelocate(
    vaultPath: string,
    existing: ManifestEntry,
    file: SyncFilePlan
  ): Promise<boolean> {
    if (
      existing.kind !== file.kind ||
      existing.sourcePath !== file.sourcePath ||
      existing.moodleModifiedAt !== file.moodleModifiedAt
    ) {
      return false
    }
    if (file.kind === 'note') {
      if (file.note?.mode === 'inline') {
        return Boolean(file.contentHash) && existing.contentHash === file.contentHash
      }
      return Boolean(file.moodleModifiedAt)
    }
    if (existing.size !== file.size) {
      return false
    }
    try {
      const info = await stat(absoluteFromRelative(vaultPath, existing.relativePath))
      if (!info.isFile()) {
        return false
      }
      return file.size <= 0 || info.size === file.size
    } catch {
      return false
    }
  }

  private async downloadFile(
    api: MoodleApi,
    vaultPath: string,
    file: SyncFilePlan
  ): Promise<void> {
    if (!file.content.fileurl) {
      throw new Error('URL del file assente.')
    }
    const target = absoluteFromRelative(vaultPath, file.relativePath)
    await mkdir(dirname(target), { recursive: true })
    const temporaryPath = `${target}.part`
    try {
      const response = await api.fetchFile(file.content.fileurl)
      const body = response.body as unknown as
        | import('node:stream/web').ReadableStream<Uint8Array>
        | null
      if (!body) {
        throw new Error('Risposta senza contenuto.')
      }
      await pipeline(Readable.fromWeb(body), createWriteStream(temporaryPath))
      try {
        await rename(temporaryPath, target)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST' && code !== 'EPERM') {
          throw error
        }
        await rm(target, { force: true })
        await rename(temporaryPath, target)
      }
      if (file.moodleModifiedAt) {
        const modified = new Date(file.moodleModifiedAt)
        await utimes(target, new Date(), modified).catch(() => undefined)
      }
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private buildEntry(
    plan: CourseSyncPlan,
    file: SyncFilePlan,
    existing: ManifestEntry | undefined,
    now: string,
    downloadedAt: string,
    wasDownloaded: boolean
  ): ManifestEntry {
    const courseName = plan.course.displayname || plan.course.fullname
    const tags = ['moodle', 'unipd', plan.courseTag]
    if (file.kind === 'note' && file.note?.type) {
      tags.push(file.note.type)
    }
    const events = existing ? [...existing.events] : []
    if (!existing) {
      events.push({ type: 'added', at: now })
    } else if (existing.status === 'removed') {
      events.push({ type: 'restored', at: now })
    }
    return {
      key: file.key,
      kind: file.kind,
      category: file.category,
      courseId: plan.course.id,
      courseName,
      courseFolder: plan.courseFolder,
      courseTag: plan.courseTag,
      sectionId: file.sectionId,
      sectionName: file.sectionName,
      sectionFolder: file.sectionFolder,
      moduleId: file.moduleId,
      moduleName: file.moduleName,
      moduleFolder: file.moduleFolder,
      filename: file.filename,
      filepath: file.content.filepath,
      mimeType: file.mimeType,
      size: file.size,
      moodleAddedAt: file.moodleAddedAt,
      moodleModifiedAt: file.moodleModifiedAt,
      sourcePath: file.sourcePath,
      sourceUrl: file.sourceUrl,
      relativePath: file.relativePath,
      sidecarPath: file.kind === 'note' ? '' : sidecarPathFor(file.relativePath),
      noteType: file.note?.type ?? existing?.noteType ?? null,
      noteBody: file.noteBody ?? existing?.noteBody ?? null,
      contentHash: file.contentHash ?? existing?.contentHash ?? null,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      downloadedAt: wasDownloaded ? now : downloadedAt,
      status: 'present',
      removedDetectedAt: null,
      tags,
      previousTags: existing?.previousTags ?? [],
      events
    }
  }

  private async removeMovedFile(
    vaultPath: string,
    previous: ManifestEntry
  ): Promise<void> {
    try {
      await rm(absoluteFromRelative(vaultPath, previous.relativePath), { force: true })
      if (previous.sidecarPath) {
        await removeSidecar(vaultPath, previous.sidecarPath)
      }
    } catch (error) {
      logger.debug('Pulizia vecchio percorso non riuscita:', errorMessage(error))
    }
  }

  private update(partial: Partial<SyncProgress>): void {
    this.state = { ...this.state, ...partial }
    const snapshot = structuredClone(this.state)
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

function noteContentHash(file: SyncFilePlan): string | null {
  if (file.noteBody == null) {
    return null
  }
  return createHash('sha256')
    .update(file.note?.type ?? 'note')
    .update('\0')
    .update(file.note?.title ?? '')
    .update('\0')
    .update(file.note?.externalUrl ?? '')
    .update('\0')
    .update(file.noteBody)
    .digest('hex')
}

function existingPathKeysForCourse(
  manifest: SyncManifest,
  courseId: number,
  vaultPath: string,
  courseFolder: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  for (const entry of Object.values(manifest.entries)) {
    if (entry.courseId === courseId) {
      result.set(entry.relativePath.toLowerCase(), entry.key)
    }
  }
  const vaultRoot = resolve(vaultPath)
  const courseRoot = absoluteFromRelative(vaultRoot, courseFolder)
  return collectOccupiedPaths(vaultRoot, courseRoot, result).then(() => result)
}

async function collectOccupiedPaths(
  root: string,
  directory: string,
  paths: Map<string, string>
): Promise<void> {
  let children
  try {
    children = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const child of children) {
    if (child.isSymbolicLink()) continue
    if (child.isDirectory()) {
      if (child.name === '.obsidian' || child.name === '.moodlescraper') continue
      await collectOccupiedPaths(root, resolve(directory, child.name), paths)
      continue
    }
    if (!child.isFile()) continue
    const relativePath = relative(root, resolve(directory, child.name)).split(sep).join('/')
    const key = relativePath.toLowerCase()
    if (!paths.has(key)) paths.set(key, '__occupied__')
  }
}

function markRemovedFiles(
  manifest: SyncManifest,
  plan: CourseSyncPlan,
  now: string,
  changedKeys: Set<string>
): number {
  const presentKeys = new Set(plan.files.map((file) => file.key))
  let removed = 0
  for (const entry of Object.values(manifest.entries)) {
    if (entry.courseId !== plan.course.id) {
      continue
    }
    if (entry.status === 'removed' || presentKeys.has(entry.key)) {
      continue
    }
    entry.status = 'removed'
    entry.removedDetectedAt = now
    entry.previousTags = [...entry.tags]
    entry.tags = [...new Set([...entry.tags, 'rimosso-da-moodle'])]
    entry.events.push({ type: 'removed', at: now })
    changedKeys.add(entry.key)
    removed += 1
  }
  return removed
}

function isAuthenticationError(error: unknown): boolean {
  if (error instanceof MoodleApiError) {
    return error.code === 'invalidtoken' || error.code === 'accessexception'
  }
  return false
}

export { initialProgress }
