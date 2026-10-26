import type { AuthService } from './auth/auth-service'
import { errorMessage, logger } from './logger'
import type { SettingsStore } from './settings-store'
import type { SyncService } from './sync/sync-service'

const DUE_DELAY_MS = 7000
const MAX_JITTER_MS = 60_000

export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null
  private stopped = false

  constructor(
    private readonly auth: AuthService,
    private readonly sync: SyncService,
    private readonly settings: SettingsStore
  ) {}

  start(): void {
    this.stopped = false
    this.refresh()
  }

  stop(): void {
    this.stopped = true
    this.clear()
  }

  refresh(): void {
    if (this.stopped) {
      return
    }
    this.clear()
    const settings = this.settings.get()
    if (!settings.autoSync) {
      return
    }
    if (this.sync.getProgress().phase === 'paused') {
      return
    }
    if (this.auth.getStatus().state !== 'authenticated') {
      return
    }
    const intervalMs = settings.syncIntervalMinutes * 60_000
    const lastSync = settings.lastSyncAt ? Date.parse(settings.lastSyncAt) : Number.NaN
    const due =
      !Number.isFinite(lastSync) || Date.now() - lastSync >= intervalMs
    const delay = due
      ? DUE_DELAY_MS
      : intervalMs + Math.floor(Math.random() * MAX_JITTER_MS)
    this.schedule(delay)
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick()
    }, delay)
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return
    }
    if (this.sync.getProgress().phase === 'paused') {
      return
    }
    const settings = this.settings.get()
    if (!settings.autoSync || this.auth.getStatus().state !== 'authenticated') {
      this.refresh()
      return
    }
    try {
      await this.sync.start({ reason: 'scheduled' })
    } catch (error) {
      logger.warn('Sync automatica non riuscita:', errorMessage(error))
    } finally {
      this.refresh()
    }
  }

  private clear(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
