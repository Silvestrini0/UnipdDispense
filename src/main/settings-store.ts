import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { ACCENT_COLORS, MOODLE_BASE_URL, THEME_MODES } from '../shared/types'
import type { AppSettings, SettingsPatch } from '../shared/types'

const settingsSchema = z.object({
  vaultPath: z.string().min(1),
  moodleBaseUrl: z.string().url().catch(MOODLE_BASE_URL),
  themeMode: z.enum(THEME_MODES).default('light'),
  accentColor: z.enum(ACCENT_COLORS).default('blue'),
  personalizationCompleted: z.boolean().default(true),
  syncIntervalMinutes: z.number().int().min(5).max(1440),
  autoSync: z.boolean(),
  launchAtLogin: z.boolean(),
  syncAllCourses: z.boolean(),
  selectedCourseIds: z.array(z.number().int().positive()),
  lastSyncAt: z.string().nullable()
})

function normalize(settings: AppSettings): AppSettings {
  return {
    ...settings,
    vaultPath: settings.vaultPath.trim(),
    moodleBaseUrl: settings.moodleBaseUrl.trim().replace(/\/+$/, ''),
    selectedCourseIds: [...new Set(settings.selectedCourseIds)]
  }
}

export class SettingsStore {
  private state: AppSettings
  private writeChain: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(settings: AppSettings) => void>()

  constructor(
    private readonly filePath: string,
    defaults: AppSettings
  ) {
    this.state = normalize(defaults)
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      this.state = normalize(settingsSchema.parse(JSON.parse(raw)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await this.backupInvalidFile()
      }
    }
    return this.get()
  }

  get(): AppSettings {
    return structuredClone(this.state)
  }

  async update(patch: SettingsPatch): Promise<AppSettings> {
    const next = normalize(
      settingsSchema.parse({
        ...this.state,
        ...patch
      })
    )
    this.state = next
    await this.persist()
    this.emit()
    return this.get()
  }

  onChange(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const snapshot = this.get()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2)
    const run = this.writeChain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      await writeFile(temporaryPath, `${snapshot}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, this.filePath)
    })
    this.writeChain = run.catch(() => undefined)
    await run
  }

  private async backupInvalidFile(): Promise<void> {
    try {
      await rename(this.filePath, `${this.filePath}.invalid-${Date.now()}`)
    } catch {
      return
    }
  }
}
