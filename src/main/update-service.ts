import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { autoUpdater, CancellationToken } from 'electron-updater'
import { IPC } from '../shared/ipc'
import type { AppUpdateStatus } from '../shared/types'
import { logger } from './logger'
import type { SettingsStore } from './settings-store'
import {
  downloadMacUpdate,
  findMacUpdate,
  installMacUpdate,
  loadPendingMacUpdate,
  openMacSecuritySettings,
  type MacUpdatePackage
} from './mac-updater'

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export class UpdateService {
  private status: AppUpdateStatus = {
    supported: false,
    state: 'unsupported',
    currentVersion: app.getVersion(),
    availableVersion: null,
    percent: 0,
    error: null
  }
  private interval: NodeJS.Timeout | null = null
  private started = false
  private macUpdate: MacUpdatePackage | null = null
  private macArchivePath: string | null = null
  private downloadCancellationToken: CancellationToken | null = null
  private macDownloadController: AbortController | null = null
  private installationPending = false

  constructor(
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly settings: SettingsStore,
    private readonly isSyncRunning: () => boolean = () => false
  ) {}

  getStatus(): AppUpdateStatus {
    return structuredClone(this.status)
  }

  get isInstalling(): boolean {
    return this.installationPending
  }

  start(): void {
    if (this.started || !this.isSupportedBuild()) {
      return
    }
    this.started = true
    this.status = { ...this.status, supported: true, state: 'idle' }

    if (process.platform === 'darwin') {
      void this.startMacUpdater()
      this.interval = setInterval(() => void this.check(), UPDATE_CHECK_INTERVAL_MS)
      this.interval.unref()
      return
    }

    // Keep the choice to install explicit even when automatic downloads are enabled.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => {
      this.update({ state: 'checking', error: null })
    })
    autoUpdater.on('update-available', (info) => {
      this.update({
        state: 'available',
        availableVersion: info.version,
        percent: 0,
        error: null
      })
      if (this.settings.get().autoUpdates) {
        void this.download()
      }
    })
    autoUpdater.on('update-not-available', () => {
      this.update({
        state: 'idle',
        availableVersion: null,
        percent: 0,
        error: null
      })
    })
    autoUpdater.on('download-progress', (progress) => {
      if (this.status.state === 'canceling') return
      this.update({ state: 'downloading', percent: progress.percent })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.update({
        state: 'downloaded',
        availableVersion: info.version,
        percent: 100,
        error: null
      })
    })
    autoUpdater.on('error', (error) => {
      if (this.downloadCancellationToken?.cancelled) return
      logger.error('Aggiornamento non riuscito:', error)
      this.update({ state: 'error', error: readableError(error) })
    })

    void this.check()
    this.interval = setInterval(() => void this.check(), UPDATE_CHECK_INTERVAL_MS)
    this.interval.unref()
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  setAutomatic(enabled: boolean): void {
    if (enabled && this.status.state === 'available') {
      void this.download()
    }
  }

  async check(): Promise<void> {
    if (
      !this.status.supported ||
      this.status.state === 'checking' ||
      this.status.state === 'downloading' ||
      this.status.state === 'canceling' ||
      this.status.state === 'downloaded' ||
      this.status.state === 'installing'
    ) {
      return
    }
    this.update({ state: 'checking', error: null })
    if (process.platform === 'darwin') {
      try {
        const update = await findMacUpdate(this.status.currentVersion)
        this.macUpdate = update
        if (!update) {
          this.update({ state: 'idle', availableVersion: null, percent: 0, error: null })
          return
        }
        this.update({ state: 'available', availableVersion: update.version, percent: 0, error: null })
        if (this.settings.get().autoUpdates) {
          await this.download()
        }
      } catch (error) {
        this.update({ state: 'error', error: readableError(error) })
      }
      return
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.update({ state: 'error', error: readableError(error) })
    }
  }

  async download(): Promise<void> {
    const canRetry = this.status.state === 'error' && this.status.availableVersion !== null
    if (
      !this.status.supported ||
      this.status.state === 'downloading' ||
      this.status.state === 'canceling' ||
      (this.status.state !== 'available' && !canRetry)
    ) {
      return
    }
    const cancellationToken = process.platform === 'darwin' ? null : new CancellationToken()
    const macDownloadController = process.platform === 'darwin' ? new AbortController() : null
    this.downloadCancellationToken = cancellationToken
    this.macDownloadController = macDownloadController
    this.update({ state: 'downloading', percent: 0, error: null })
    if (process.platform === 'darwin') {
      if (!this.macUpdate) {
        this.macDownloadController = null
        this.update({ state: 'error', error: 'Il pacchetto di aggiornamento Mac non è disponibile. Ricontrolla le versioni.' })
        return
      }
      try {
        const pending = await downloadMacUpdate(this.macUpdate, (percent) => {
          if (macDownloadController?.signal.aborted || this.status.state === 'canceling') return
          this.update({ state: 'downloading', percent })
        }, macDownloadController?.signal)
        if (macDownloadController?.signal.aborted) return
        this.macArchivePath = pending.archivePath
        this.update({
          state: 'downloaded',
          availableVersion: pending.version,
          percent: 100,
          error: null
        })
      } catch (error) {
        if (!macDownloadController?.signal.aborted) {
          this.update({ state: 'error', error: readableError(error) })
        }
      } finally {
        if (this.macDownloadController === macDownloadController) {
          this.macDownloadController = null
          if (macDownloadController?.signal.aborted) {
            this.update({ state: 'available', percent: 0, error: null })
          }
        }
      }
      return
    }
    try {
      await autoUpdater.downloadUpdate(cancellationToken ?? undefined)
    } catch (error) {
      if (!cancellationToken?.cancelled) {
        this.update({ state: 'error', error: readableError(error) })
      }
    } finally {
      if (this.downloadCancellationToken === cancellationToken) {
        this.downloadCancellationToken = null
        if (cancellationToken?.cancelled && this.getStatus().state === 'canceling') {
          this.update({ state: 'available', percent: 0, error: null })
        }
      }
    }
  }

  cancelDownload(): void {
    if (this.status.state !== 'downloading') return
    this.update({ state: 'canceling' })
    if (this.downloadCancellationToken) {
      this.downloadCancellationToken.cancel()
    } else if (this.macDownloadController) {
      this.macDownloadController.abort()
    } else {
      this.update({ state: 'available', percent: 0, error: null })
    }
  }

  install(): void {
    if (
      !this.status.supported ||
      this.status.state !== 'downloaded' ||
      this.installationPending
    ) {
      return
    }
    if (this.isSyncRunning()) {
      throw new Error('Attendi il completamento della sincronizzazione prima di installare l’aggiornamento.')
    }
    if (process.platform === 'darwin') {
      if (!this.macArchivePath || !this.status.availableVersion) {
        this.update({ state: 'error', error: 'Il pacchetto Mac scaricato non è più disponibile.' })
        return
      }
      this.installationPending = true
      this.update({ state: 'installing', error: null })
      void installMacUpdate(this.macArchivePath, this.status.availableVersion)
        .catch((error) => {
          this.installationPending = false
          logger.error('Installazione aggiornamento Mac non riuscita:', error)
          this.update({ state: 'error', error: readableError(error) })
        })
      return
    }
    this.installationPending = true
    this.update({ state: 'installing', error: null })
    autoUpdater.quitAndInstall(true, true)
  }

  async openSecuritySettings(): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error('Le impostazioni di sicurezza macOS non sono disponibili su questo sistema.')
    }
    await openMacSecuritySettings()
  }

  private async startMacUpdater(): Promise<void> {
    try {
      const pending = await loadPendingMacUpdate(this.status.currentVersion)
      if (pending) {
        this.macUpdate = pending
        this.macArchivePath = pending.archivePath
        this.update({
          state: 'downloaded',
          availableVersion: pending.version,
          percent: 100
        })
        return
      }
    } catch (error) {
      logger.warn('Ripristino aggiornamento Mac in sospeso non riuscito:', error)
    }
    await this.check()
  }

  private update(patch: Partial<AppUpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    const window = this.getMainWindow()
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(IPC.updatesChanged, this.getStatus())
    }
  }

  private isSupportedBuild(): boolean {
    if (!app.isPackaged) {
      return false
    }
    if (process.platform === 'win32') {
      return process.arch === 'x64'
    }
    if (process.platform === 'darwin') {
      return process.arch === 'x64' || process.arch === 'arm64'
    }
    return process.platform === 'linux' && process.arch === 'x64' && isSupportedLinuxPackage()
  }
}

function isSupportedLinuxPackage(): boolean {
  if (process.env.APPIMAGE) {
    return true
  }
  try {
    const packageType = readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim()
    return packageType === 'deb' || packageType === 'rpm'
  } catch {
    return false
  }
}

function readableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error:\s*/, '')
}
