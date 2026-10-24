import { readFileSync, readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app, dialog, session, shell } from 'electron'
import { IPC } from '../shared/ipc'
import {
  APP_ID,
  APP_NAME,
  MOODLE_AUTH_PARTITION,
  MOODLE_BASE_URL,
  type AppInfo,
  type AppSettings,
  type AuthStatus,
  type SyncProgress
} from '../shared/types'
import { AuthService } from './auth/auth-service'
import { CourseService } from './course-service'
import { MaterialsService } from './materials-service'
import { registerIpc } from './ipc'
import { logger } from './logger'
import { createAppTray, type AppTray } from './tray'
import { SyncScheduler } from './scheduler'
import { SecretsStore } from './secrets-store'
import { SettingsStore } from './settings-store'
import { SyncService } from './sync/sync-service'
import { createMainWindow, markQuitting } from './window'

let mainWindow: Awaited<ReturnType<typeof createMainWindow>> | null = null
let appTray: AppTray | null = null
let scheduler: SyncScheduler | null = null

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.setName(APP_NAME)
  // Keep the existing settings and encrypted session after the product rename.
  app.setPath('userData', join(app.getPath('appData'), 'UniPD Dispense'))
  app.setAppUserModelId(APP_ID)
  configureKeyringBackend()

  app.on('second-instance', () => {
    showMainWindow()
  })

  app.on('before-quit', () => {
    markQuitting()
    scheduler?.stop()
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })

  app.on('activate', () => {
    showMainWindow()
  })

  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      logger.error('Avvio non riuscito:', error)
      dialog.showErrorBox(
        APP_NAME,
        `Impossibile avviare l’applicazione.\n\n${error instanceof Error ? error.message : String(error)}`
      )
      app.quit()
    })
}

async function bootstrap(): Promise<void> {
  logger.info(`Avvio ${APP_NAME} ${app.getVersion()}`)
  const userDataPath = app.getPath('userData')
  const settings = new SettingsStore(join(userDataPath, 'settings.json'), {
    vaultPath: join(app.getPath('documents'), 'UniPD'),
    moodleBaseUrl: MOODLE_BASE_URL,
    syncIntervalMinutes: 30,
    autoSync: true,
    launchAtLogin: false,
    syncAllCourses: true,
    selectedCourseIds: [],
    lastSyncAt: null
  })
  await settings.load()

  const secrets = new SecretsStore(join(userDataPath, 'secrets.bin'))
  await secrets.load()

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session
    .fromPartition(MOODLE_AUTH_PARTITION)
    .setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })

  const auth = new AuthService(
    settings.get().moodleBaseUrl,
    MOODLE_AUTH_PARTITION,
    secrets
  )
  const courses = new CourseService(auth)
  const sync = new SyncService(auth, settings)
  const materials = new MaterialsService(settings, () => mainWindow)
  const info = (): AppInfo => ({
    name: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    secureStorage: secrets.secureStorage,
    userDataPath
  })

  mainWindow = createMainWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  registerIpc({
    getMainWindow: () => mainWindow,
    getInfo: info,
    settings,
    auth,
    courses,
    materials,
    sync,
    chooseVault: () => chooseVault(settings.get().vaultPath),
    openVault: async () => {
      const vaultPath = settings.get().vaultPath
      await mkdir(vaultPath, { recursive: true })
      const error = await shell.openPath(vaultPath)
      if (error) {
        throw new Error(error)
      }
    },
    quit: () => {
      markQuitting()
      app.quit()
    }
  })

  appTray = createAppTray({
    auth,
    sync,
    showWindow: showMainWindow,
    openVault: async () => {
      const vaultPath = settings.get().vaultPath
      await mkdir(vaultPath, { recursive: true })
      const error = await shell.openPath(vaultPath)
      if (error) {
        throw new Error(error)
      }
    }
  })

  auth.onStatusChanged((status: AuthStatus) => {
    broadcast(IPC.authChanged, status)
    appTray?.refresh()
    scheduler?.refresh()
  })
  settings.onChange((next: AppSettings) => {
    auth.setBaseUrl(next.moodleBaseUrl)
    broadcast(IPC.settingsChanged, next)
    appTray?.refresh()
    scheduler?.refresh()
    applyLaunchAtLogin(next)
  })
  sync.onProgress((progress: SyncProgress) => {
    broadcast(IPC.syncProgress, progress)
  })

  applyLaunchAtLogin(settings.get())

  const syncScheduler = new SyncScheduler(auth, sync, settings)
  scheduler = syncScheduler
  syncScheduler.start()

  mainWindow.webContents.once('did-finish-load', () => {
    void initializeSession(auth, syncScheduler)
  })
}

async function initializeSession(
  auth: AuthService,
  syncScheduler: SyncScheduler
): Promise<void> {
  try {
    const status = await auth.restore()
    if (status.state === 'authenticated') {
      syncScheduler.refresh()
    }
  } catch (error) {
    logger.warn('Ripristino sessione non riuscito:', error)
  }
}

async function chooseVault(defaultPath: string): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Scegli il vault Obsidian',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) {
    return null
  }
  return result.filePaths[0]
}

function showMainWindow(): void {
  if (!mainWindow) {
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

function broadcast(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function configureKeyringBackend(): void {
  if (process.platform !== 'linux' || !process.env.DBUS_SESSION_BUS_ADDRESS) {
    return
  }
  if (isProcessRunning('gnome-keyring-daemon')) {
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
  }
}

function isProcessRunning(name: string): boolean {
  try {
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) {
        continue
      }
      try {
        if (readFileSync(`/proc/${entry}/comm`, 'utf8').trim() === name) {
          return true
        }
      } catch {
        // Processi terminati nel frattempo.
      }
    }
  } catch {
    return false
  }
  return false
}

function applyLaunchAtLogin(settings: AppSettings): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtLogin,
      args: ['--hidden']
    })
  } catch (error) {
    logger.warn('Impossibile configurare l’avvio automatico:', String(error))
  }
}
