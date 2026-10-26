import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  lstat,
  realpath,
  rename,
  rm,
  stat,
  utimes
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  AppSettings,
  CourseFolderToDelete,
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
  renderNote,
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
    backedUp: 0,
    localChanges: 0,
    errors: 0,
    startedAt: null,
    finishedAt: null
  }
}

type ProgressListener = (progress: SyncProgress) => void

export class SyncService {
  private state: SyncProgress = initialProgress()
  private runPromise: Promise<SyncResult> | null = null
  private stopRequested = false
  private activeAbortController: AbortController | null = null
  private readonly listeners = new Set<ProgressListener>()
  private startGuard: (() => string | null) | null = null

  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsStore
  ) {}

  getProgress(): SyncProgress {
    return structuredClone(this.state)
  }

  async listUnselectedCourseFolders(
    courseIds: number[]
  ): Promise<CourseFolderToDelete[]> {
    const vaultPath = resolve(this.settings.get().vaultPath)
    const manifest = await new ManifestStore(vaultPath).load()
    const selectedIds = new Set(courseIds)
    const folders = new Map<number, CourseFolderToDelete>()
    for (const entry of Object.values(manifest.entries)) {
      if (selectedIds.has(entry.courseId) || folders.has(entry.courseId)) continue
      const path = courseFolderPath(vaultPath, entry.courseFolder)
      try {
        const info = await lstat(path)
        if (!info.isDirectory() || info.isSymbolicLink()) continue
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      folders.set(entry.courseId, {
        courseId: entry.courseId,
        courseName: entry.courseName,
        courseFolder: entry.courseFolder
      })
    }
    return [...folders.values()].sort((left, right) =>
      left.courseName.localeCompare(right.courseName, 'it', { sensitivity: 'base' })
    )
  }

  async restoreInterruptedState(): Promise<void> {
    const vaultPath = resolve(this.settings.get().vaultPath)
    const manifest = await new ManifestStore(vaultPath).load()
    if (manifest.interrupted) {
      this.update({
        ...initialProgress(),
        phase: 'paused',
        message: 'La sincronizzazione precedente si è interrotta. Puoi riprenderla: i file già completati verranno mantenuti.'
      })
    }
  }

  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setStartGuard(guard: () => string | null): void {
    this.startGuard = guard
  }

  start(options: SyncOptions = {}): Promise<SyncResult> {
    const blockedReason = this.startGuard?.()
    if (blockedReason) {
      return Promise.reject(new Error(blockedReason))
    }
    if (this.runPromise) {
      if (options.freshCopyRoot) {
        return Promise.reject(
          new Error('Ferma la sincronizzazione in corso prima di creare una nuova copia.')
        )
      }
      return this.runPromise
    }
    this.runPromise = this.run(options).finally(() => {
      this.runPromise = null
    })
    return this.runPromise
  }

  stop(): boolean {
    if (!this.state.running || this.state.phase === 'finalizing') {
      return false
    }
    this.stopRequested = true
    this.activeAbortController?.abort()
    this.update({ message: 'Arresto in corso… salvo i file già completati.' })
    return true
  }

  private async run(options: SyncOptions): Promise<SyncResult> {
    this.stopRequested = false
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
      if (result.paused) {
        this.update({
          running: false,
          phase: 'paused',
          message: 'Sincronizzazione fermata. I file completati sono al sicuro; puoi riprenderla quando vuoi.',
          currentFile: null,
          finishedAt: result.finishedAt
        })
        return result
      }
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
    let settings = this.settings.get()
    let vaultPath = resolve(settings.vaultPath)
    if (options.freshCopyRoot) {
      const targetPath = await createFreshVaultPath(
        options.freshCopyRoot,
        vaultPath
      )
      settings = await this.settings.update({ vaultPath: targetPath, lastSyncAt: null })
      vaultPath = resolve(targetPath)
      logger.info(`Nuova copia dei materiali in ${vaultPath}.`)
    }
    await mkdir(vaultPath, { recursive: true })
    await cleanupInterruptedDownloads(vaultPath)
    const manifestStore = new ManifestStore(vaultPath)
    const manifest = await manifestStore.load()
    manifest.interrupted = true
    await manifestStore.save(manifest)
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
    const prepared: CourseSyncPlan[] = []
    const errors: SyncResult['errors'] = []
    let total = 0
    let processed = 0
    let downloaded = 0
    let skipped = 0
    let removed = 0
    let backedUp = 0
    let localChanges = 0
    let deletedCourses = 0
    const makeResult = (paused = false): SyncResult => ({
      downloaded,
      skipped,
      removed,
      backedUp,
      localChanges,
      errors,
      courses: prepared.length,
      ...(deletedCourses > 0 ? { deletedCourses } : {}),
      finishedAt: new Date().toISOString(),
      ...(paused ? { paused: true } : {})
    })

    const siteInfo = await api.getSiteInfo()
    if (this.stopRequested) return makeResult(true)
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
    if (this.stopRequested) return makeResult(true)
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
    for (const course of courses) {
      if (this.stopRequested) return makeResult(true)
      this.update({
        phase: 'scanning',
        courseId: course.id,
        courseName: course.displayname || course.fullname,
        message: `Analisi di ${course.displayname || course.fullname}…`
      })
      try {
        const sections = await api.getCourseContents(course.id)
        if (this.stopRequested) return makeResult(true)
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
        if (this.stopRequested) return makeResult(true)
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

    for (const plan of prepared) {
      if (this.stopRequested) return makeResult(true)
      const courseName = plan.course.displayname || plan.course.fullname
      this.update({
        courseId: plan.course.id,
        courseName,
        message: `Sincronizzazione di ${courseName}…`
      })
      for (const file of plan.files) {
        if (this.stopRequested) return makeResult(true)
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
            (await this.moveExisting(vaultPath, existing, file, manifest))
          if (moved && existing) {
            skipped += 1
            const movedEntry = this.buildEntry(
              plan,
              file,
              existing,
              now,
              existing.downloadedAt,
              false
            )
            movedEntry.pendingNoteUpdate = file.kind === 'note'
            movedEntry.pendingSidecarUpdate = file.kind === 'file'
            manifest.entries[file.key] = movedEntry
          } else if (
            existing &&
            (await this.hasUnchangedLocalEdits(vaultPath, file, existing, manifest))
          ) {
            skipped += 1
            localChanges += 1
          } else if (await this.canSkip(vaultPath, file, existing, manifest)) {
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
              if (existing && (await this.noteWasEdited(vaultPath, existing, manifest))) {
                await this.backupLocalFile(vaultPath, existing.relativePath)
                backedUp += 1
              }
              await writeNote(vaultPath, entry)
              manifest.generatedHashes ??= {}
              manifest.generatedHashes[`note:${entry.key}`] = await hashFile(
                absoluteFromRelative(vaultPath, entry.relativePath)
              )
            } else {
              const download = await this.downloadFile(api, vaultPath, file, existing)
              entry = this.buildEntry(plan, file, existing, now, now, true)
              entry.downloadHash = download.hash
              if (download.backedUp) backedUp += 1
            }
            downloaded += 1
            if (file.kind === 'file') {
              entry.pendingSidecarUpdate = true
            } else {
              entry.pendingNoteUpdate = false
            }
            manifest.entries[file.key] = entry
            if (existing && existing.relativePath !== entry.relativePath) {
              if (existing.kind === 'file' && await this.backupIfLocalFileChanged(vaultPath, existing)) {
                backedUp += 1
              }
              await this.removeMovedFile(vaultPath, existing)
            }
          }
          processed += 1
          await manifestStore.save(manifest)
          this.update({
            processed,
            downloaded,
            skipped,
            errors: errors.length,
            backedUp,
            localChanges
          })
        } catch (error) {
          if (this.stopRequested) return makeResult(true)
          if (isAuthenticationError(error)) {
            throw error
          }
          processed += 1
          errors.push({ path: file.relativePath, message: errorMessage(error) })
          this.update({ processed, errors: errors.length })
          logger.warn(`Download non riuscito ${sanitizeUrl(file.sourceUrl)}:`, errorMessage(error))
        }
      }

      if (this.stopRequested) return makeResult(true)

      const newlyRemoved = markRemovedFiles(
        manifest,
        plan,
        new Date().toISOString()
      )
      removed += newlyRemoved
      this.update({ removed, currentFile: null, errors: errors.length })
      await manifestStore.save(manifest)
    }

    if (this.stopRequested) return makeResult(true)

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
        if (!entry.pendingNoteUpdate) {
          continue
        }
        try {
          backedUp += await this.writeManagedFiles(
            vaultPath,
            manifest,
            [{ path: entry.relativePath, key: `note:${entry.key}` }],
            () => writeNote(vaultPath, entry)
          )
          entry.pendingNoteUpdate = false
        } catch (error) {
          errors.push({
            path: entry.relativePath,
            message: `Nota non aggiornata: ${errorMessage(error)}`
          })
        }
        continue
      }
      if (entry.pendingSidecarUpdate || !(await sidecarExists(vaultPath, entry))) {
        try {
          backedUp += await this.writeManagedFiles(
            vaultPath,
            manifest,
            [{ path: entry.sidecarPath, key: `sidecar:${entry.key}` }],
            () => writeSidecar(vaultPath, entry)
          )
          entry.pendingSidecarUpdate = false
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
        const entries = courseEntries[0]
        if (!entries) continue
        backedUp += await this.writeManagedFiles(
          vaultPath,
          manifest,
          [
            { path: `${entries.courseFolder}/Indice corso.md`, key: `index:${plan.course.id}` },
            {
              path: `${entries.courseFolder}/Rimossi da Moodle.md`,
              key: `removed-index:${plan.course.id}`
            }
          ],
          () => writeCourseIndexes(vaultPath, courseEntries)
        )
      } catch (error) {
        errors.push({
          path: plan.courseFolder,
          message: `Indice non aggiornato: ${errorMessage(error)}`
        })
      }
    }
    const requestedDeletions = new Set(options.deleteCourseIds ?? [])
    const selectedCourseIds = new Set(courses.map((course) => course.id))
    const deletions = new Map<number, string>()
    for (const entry of Object.values(manifest.entries)) {
      if (
        !requestedDeletions.has(entry.courseId) ||
        selectedCourseIds.has(entry.courseId)
      ) continue
      deletions.set(entry.courseId, entry.courseFolder)
    }
    for (const courseFolder of new Set(deletions.values())) {
      const sharedWithSelected = Object.values(manifest.entries).some(
        (entry) => entry.courseFolder === courseFolder && selectedCourseIds.has(entry.courseId)
      )
      if (sharedWithSelected) continue
      const folderPath = courseFolderPath(vaultPath, courseFolder)
      try {
        const info = await lstat(folderPath)
        if (!info.isDirectory() || info.isSymbolicLink()) continue
        await rm(folderPath, { recursive: true, force: true })
        const removedCourseIds = new Set<number>()
        for (const [key, entry] of Object.entries(manifest.entries)) {
          if (
            entry.courseFolder !== courseFolder ||
            selectedCourseIds.has(entry.courseId)
          ) continue
          removedCourseIds.add(entry.courseId)
          delete manifest.entries[key]
          delete manifest.generatedHashes?.[`note:${entry.key}`]
          delete manifest.generatedHashes?.[`sidecar:${entry.key}`]
        }
        for (const removedCourseId of removedCourseIds) {
          delete manifest.generatedHashes?.[`index:${removedCourseId}`]
          delete manifest.generatedHashes?.[`removed-index:${removedCourseId}`]
        }
        deletedCourses += removedCourseIds.size
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          errors.push({
            path: courseFolder,
            message: `Cartella non eliminata: ${errorMessage(error)}`
          })
        }
      }
    }
    await manifestStore.save(manifest)

    const finishedAt = new Date().toISOString()
    manifest.interrupted = false
    await manifestStore.save(manifest)
    this.update({ errors: errors.length, backedUp, localChanges })
    logger.info(
      `Sync completata: ${prepared.length} corsi, ${downloaded} scaricati, ${skipped} invariati, ${removed} rimossi, ${backedUp} copie di sicurezza, ${localChanges} modifiche locali mantenute, ${errors.length} errori (${shortDate(finishedAt)}).`
    )
    return { ...makeResult(false), finishedAt }
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
    const controller = new AbortController()
    this.activeAbortController = controller
    try {
      const response = await api.fetchFile(file.content.fileurl, controller.signal)
      return htmlToMarkdown(await response.text(), baseUrl)
    } finally {
      this.activeAbortController = null
    }
  }

  private async canSkip(
    vaultPath: string,
    file: SyncFilePlan,
    existing: ManifestEntry | undefined,
    manifest: SyncManifest
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
      if (await this.noteWasEdited(vaultPath, existing, manifest)) {
        return false
      }
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

  private async hasUnchangedLocalEdits(
    vaultPath: string,
    file: SyncFilePlan,
    existing: ManifestEntry,
    manifest: SyncManifest
  ): Promise<boolean> {
    if (
      existing.status !== 'present' ||
      existing.kind !== file.kind ||
      existing.relativePath !== file.relativePath ||
      existing.moodleModifiedAt !== file.moodleModifiedAt ||
      existing.sourcePath !== file.sourcePath ||
      (file.kind === 'note' && file.contentHash && existing.contentHash !== file.contentHash)
    ) {
      return false
    }
    if (file.kind === 'note') {
      return this.noteWasEdited(vaultPath, existing, manifest)
    }
    const target = absoluteFromRelative(vaultPath, file.relativePath)
    try {
      const info = await stat(target)
      if (!info.isFile()) return false
      if (existing.downloadHash) {
        return (await hashFile(target)) !== existing.downloadHash
      }
      return info.size !== file.size
    } catch {
      return false
    }
  }

  private async noteWasEdited(
    vaultPath: string,
    existing: ManifestEntry,
    manifest?: SyncManifest
  ): Promise<boolean> {
    try {
      const path = absoluteFromRelative(vaultPath, existing.relativePath)
      const expectedHash = manifest?.generatedHashes?.[`note:${existing.key}`]
      if (expectedHash) return (await hashFile(path)) !== expectedHash
      const current = await readFile(path, 'utf8')
      return current !== renderNote(existing)
    } catch {
      return false
    }
  }

  private async moveExisting(
    vaultPath: string,
    existing: ManifestEntry,
    file: SyncFilePlan,
    manifest: SyncManifest
  ): Promise<boolean> {
    if (!(await this.canRelocate(vaultPath, existing, file, manifest))) {
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
    file: SyncFilePlan,
    manifest: SyncManifest
  ): Promise<boolean> {
    if (
      existing.kind !== file.kind ||
      existing.sourcePath !== file.sourcePath ||
      existing.moodleModifiedAt !== file.moodleModifiedAt
    ) {
      return false
    }
    if (file.kind === 'note') {
      if (await this.noteWasEdited(vaultPath, existing, manifest)) {
        return false
      }
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
      if (
        existing.downloadHash &&
        (await hashFile(absoluteFromRelative(vaultPath, existing.relativePath))) !==
          existing.downloadHash
      ) {
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
    file: SyncFilePlan,
    existing: ManifestEntry | undefined
  ): Promise<{ hash: string; backedUp: boolean }> {
    if (!file.content.fileurl) {
      throw new Error('URL del file assente.')
    }
    const target = absoluteFromRelative(vaultPath, file.relativePath)
    await mkdir(dirname(target), { recursive: true })
    const temporaryPath = `${target}.unipddispense-download.part`
    try {
      const controller = new AbortController()
      this.activeAbortController = controller
      const response = await api.fetchFile(file.content.fileurl, controller.signal)
      const body = response.body as unknown as
        | import('node:stream/web').ReadableStream<Uint8Array>
        | null
      if (!body) {
        throw new Error('Risposta senza contenuto.')
      }
      const hash = createHash('sha256')
      const hashStream = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk)
          callback(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(body), hashStream, createWriteStream(temporaryPath))
      let backedUp =
        existing && existing.relativePath === file.relativePath
          ? await this.backupIfLocalFileChanged(vaultPath, existing)
          : false
      try {
        await rename(temporaryPath, target)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST' && code !== 'EPERM') {
          throw error
        }
        // The existing copy is retained in the backup folder before this replacement.
        if (!backedUp && existing) {
          await this.backupLocalFile(vaultPath, existing.relativePath)
          backedUp = true
        }
        await rm(target, { force: true })
        await rename(temporaryPath, target)
      }
      if (file.moodleModifiedAt) {
        const modified = new Date(file.moodleModifiedAt)
        await utimes(target, new Date(), modified).catch(() => undefined)
      }
      return { hash: hash.digest('hex'), backedUp }
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      this.activeAbortController = null
    }
  }

  private async backupIfLocalFileChanged(
    vaultPath: string,
    existing: ManifestEntry
  ): Promise<boolean> {
    const target = absoluteFromRelative(vaultPath, existing.relativePath)
    try {
      const info = await stat(target)
      if (!info.isFile()) return false
      if (existing.downloadHash && (await hashFile(target)) === existing.downloadHash) {
        return false
      }
      await this.backupLocalFile(vaultPath, existing.relativePath)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private async backupLocalFile(vaultPath: string, relativePath: string): Promise<void> {
    const source = absoluteFromRelative(vaultPath, relativePath)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = absoluteFromRelative(vaultPath, `.moodlescraper/backups/${timestamp}`)
    const destination = absoluteFromRelative(backupRoot, relativePath)
    await mkdir(dirname(destination), { recursive: true })
    let target = destination
    let suffix = 1
    while (true) {
      try {
        await stat(target)
        const extensionIndex = destination.lastIndexOf('.')
        target = extensionIndex > destination.lastIndexOf(sep)
          ? `${destination.slice(0, extensionIndex)} (${suffix++})${destination.slice(extensionIndex)}`
          : `${destination} (${suffix++})`
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        break
      }
    }
    await copyFile(source, target)
    logger.info(`Copia di sicurezza creata: ${relative(vaultPath, target).split(sep).join('/')}`)
  }

  private async writeManagedFiles(
    vaultPath: string,
    manifest: SyncManifest,
    files: Array<{ path: string; key: string }>,
    write: () => Promise<void>
  ): Promise<number> {
    let backedUp = 0
    for (const file of files) {
      const absolutePath = absoluteFromRelative(vaultPath, file.path)
      try {
        const info = await stat(absolutePath)
        if (!info.isFile()) continue
        const expectedHash = manifest.generatedHashes?.[file.key]
        if (!expectedHash || (await hashFile(absolutePath)) !== expectedHash) {
          await this.backupLocalFile(vaultPath, file.path)
          backedUp += 1
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await write()
    manifest.generatedHashes ??= {}
    for (const file of files) {
      const absolutePath = absoluteFromRelative(vaultPath, file.path)
      try {
        manifest.generatedHashes[file.key] = await hashFile(absolutePath)
      } catch {
        // A missing generated file can be rebuilt on the next synchronization.
      }
    }
    return backedUp
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
      downloadHash: file.kind === 'file' ? existing?.downloadHash ?? null : null,
      pendingNoteUpdate: existing?.pendingNoteUpdate,
      pendingSidecarUpdate: existing?.pendingSidecarUpdate,
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

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

async function createFreshVaultPath(rootPath: string, currentVaultPath: string): Promise<string> {
  if (!isAbsolute(rootPath)) {
    throw new Error('Scegli una cartella di destinazione valida.')
  }
  await mkdir(rootPath, { recursive: true })
  const destinationRoot = await realpath(rootPath)
  const currentRoot = await realpath(currentVaultPath).catch(() => resolve(currentVaultPath))
  const relation = relative(currentRoot, destinationRoot)
  const isInsideCurrentVault =
    relation === '' ||
    (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
  if (isInsideCurrentVault) {
    throw new Error('Scegli una cartella fuori dal vault attuale: la copia precedente verrà conservata.')
  }

  const date = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-')
  const baseName = `Unipd Dispense - nuova copia ${date}`
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const folderName = suffix === 0 ? baseName : `${baseName} (${suffix + 1})`
    const candidate = join(destinationRoot, folderName)
    try {
      await mkdir(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('Non riesco a creare una cartella libera per la nuova copia.')
}

async function cleanupInterruptedDownloads(vaultPath: string): Promise<void> {
  const visit = async (directory: string): Promise<void> => {
    let children
    try {
      children = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const child of children) {
      if (child.isSymbolicLink()) continue
      const path = join(directory, child.name)
      if (child.isDirectory()) {
        await visit(path)
      } else if (
        child.isFile() &&
        (child.name.endsWith('.unipddispense-download.part') ||
          child.name.endsWith('.unipddispense-write.tmp'))
      ) {
        await rm(path, { force: true })
      }
    }
  }
  await visit(vaultPath)
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
  now: string
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
    if (entry.kind === 'note') {
      entry.pendingNoteUpdate = true
    } else {
      entry.pendingSidecarUpdate = true
    }
    removed += 1
  }
  return removed
}

function courseFolderPath(vaultPath: string, courseFolder: string): string {
  if (
    !courseFolder ||
    courseFolder === '.' ||
    courseFolder === '..' ||
    courseFolder.includes('/') ||
    courseFolder.includes('\\') ||
    courseFolder.startsWith('.')
  ) {
    throw new Error('La cartella del corso non è valida.')
  }
  const folderPath = absoluteFromRelative(vaultPath, courseFolder)
  if (relative(resolve(vaultPath), folderPath) !== courseFolder) {
    throw new Error('La cartella del corso non è valida.')
  }
  return folderPath
}

function isAuthenticationError(error: unknown): boolean {
  if (error instanceof MoodleApiError) {
    return error.code === 'invalidtoken' || error.code === 'accessexception'
  }
  return false
}

export { initialProgress }
