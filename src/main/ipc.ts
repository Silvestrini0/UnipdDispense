import {
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent
} from 'electron'
import type {
  AppInfo,
  AppSnapshot,
  SettingsPatch,
  SyncOptions
} from '../shared/types'
import { IPC } from '../shared/ipc'
import type { AuthService } from './auth/auth-service'
import type { CourseService } from './course-service'
import type { MaterialsService } from './materials-service'
import type { SettingsStore } from './settings-store'
import type { SyncService } from './sync/sync-service'
import type { UpdateService } from './update-service'

interface IpcDependencies {
  getMainWindow: () => BrowserWindow | null
  getInfo: () => AppInfo
  settings: SettingsStore
  auth: AuthService
  courses: CourseService
  materials: MaterialsService
  sync: SyncService
  updates: UpdateService
  chooseVault: () => Promise<string | null>
  chooseFreshSyncLocation: () => Promise<string | null>
  openVault: () => Promise<void>
  quit: () => void
}

export function registerIpc(dependencies: IpcDependencies): void {
  const {
    getMainWindow,
    getInfo,
    settings,
    auth,
    courses,
    materials,
    sync,
    updates,
    chooseVault,
    chooseFreshSyncLocation,
    openVault,
    quit
  } = dependencies

  const handle = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event, getMainWindow())
      return listener(event, ...args)
    })
  }

  handle(IPC.appInfo, () => getInfo())
  handle(IPC.appSnapshot, (): AppSnapshot => {
    return {
      info: getInfo(),
      settings: settings.get(),
      update: updates.getStatus(),
      auth: auth.getStatus(),
      sync: sync.getProgress(),
      courses: []
    }
  })
  handle(IPC.appOpenVault, () => openVault())
  handle(IPC.appQuit, () => quit())
  handle(IPC.settingsGet, () => settings.get())
  handle(IPC.settingsUpdate, (_event, patch) =>
    settings.update(patch as SettingsPatch)
  )
  handle(IPC.settingsChooseVault, () => chooseVault())
  handle(IPC.authStatus, () => auth.getStatus())
  handle(IPC.authLogin, () => auth.login())
  handle(IPC.authLogout, () => auth.logout())
  handle(IPC.coursesList, () => courses.list())
  handle(IPC.materialsList, () => materials.list())
  handle(IPC.materialsRecentAdded, (_event, courseId) => {
    if (
      courseId !== null &&
      (typeof courseId !== 'number' || !Number.isInteger(courseId) || courseId <= 0)
    ) {
      throw new Error('Corso non valido.')
    }
    return materials.recentAdded(courseId)
  })
  handle(IPC.materialsOpen, (_event, relativePath, mode) => {
    if (typeof relativePath !== 'string') {
      throw new Error('Percorso del file non valido.')
    }
    return materials.open(relativePath, mode === 'folder' ? 'folder' : 'default')
  })
  handle(IPC.materialsPreview, (_event, relativePath) => {
    if (typeof relativePath !== 'string') {
      throw new Error('Percorso del file non valido.')
    }
    return materials.preview(relativePath)
  })
  handle(IPC.syncStart, (_event, options) =>
    sync.start(parseSyncOptions(options))
  )
  handle(IPC.syncListUnselectedCourseFolders, (_event, courseIds) =>
    sync.listUnselectedCourseFolders(parseCourseIds(courseIds))
  )
  handle(IPC.syncStop, () => sync.stop())
  handle(IPC.syncChooseFreshLocation, () => chooseFreshSyncLocation())
  handle(IPC.syncStatus, () => sync.getProgress())
  handle(IPC.updatesCheck, () => updates.check())
  handle(IPC.updatesDownload, () => updates.download())
  handle(IPC.updatesInstall, () => updates.install())
  handle(IPC.updatesOpenSecuritySettings, () => updates.openSecuritySettings())

}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow | null
): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Richiesta IPC non autorizzata.')
  }
}

function parseSyncOptions(value: unknown): SyncOptions {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const record = value as Record<string, unknown>
  const options: SyncOptions = {}
  if (Array.isArray(record.courseIds)) {
    options.courseIds = parseCourseIds(record.courseIds)
  }
  if (Array.isArray(record.deleteCourseIds)) {
    options.deleteCourseIds = parseCourseIds(record.deleteCourseIds)
  }
  if (
    record.reason === 'manual' ||
    record.reason === 'scheduled' ||
    record.reason === 'startup'
  ) {
    options.reason = record.reason
  }
  if (typeof record.freshCopyRoot === 'string') {
    options.freshCopyRoot = record.freshCopyRoot
  }
  return options
}

function parseCourseIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(
    (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0
  ))]
}
