import type {
  AppInfo,
  AppSettings,
  AppUpdateStatus,
  AppSnapshot,
  AuthStatus,
  CourseFolderToDelete,
  CourseSummary,
  MaterialFile,
  RecentAddedFile,
  SettingsPatch,
  SyncOptions,
  SyncProgress,
  SyncResult
} from './types'

export const IPC = {
  appInfo: 'app:info',
  appSnapshot: 'app:snapshot',
  appOpenVault: 'app:open-vault',
  appQuit: 'app:quit',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChooseVault: 'settings:choose-vault',
  settingsChanged: 'settings:changed',
  authStatus: 'auth:status',
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authChanged: 'auth:changed',
  coursesList: 'courses:list',
  syncStart: 'sync:start',
  syncListUnselectedCourseFolders: 'sync:list-unselected-course-folders',
  syncStop: 'sync:stop',
  syncChooseFreshLocation: 'sync:choose-fresh-location',
  syncStatus: 'sync:status',
  syncProgress: 'sync:progress',
  materialsList: 'materials:list',
  materialsRecentAdded: 'materials:recent-added',
  materialsOpen: 'materials:open',
  materialsPreview: 'materials:preview',
  updatesCheck: 'updates:check',
  updatesDownload: 'updates:download',
  updatesCancelDownload: 'updates:cancel-download',
  updatesInstall: 'updates:install',
  updatesOpenSecuritySettings: 'updates:open-security-settings',
  updatesChanged: 'updates:changed'
} as const

export interface DesktopApi {
  app: {
    getInfo: () => Promise<AppInfo>
    getSnapshot: () => Promise<AppSnapshot>
    openVault: () => Promise<void>
    quit: () => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (patch: SettingsPatch) => Promise<AppSettings>
    chooseVault: () => Promise<string | null>
    onChange: (callback: (settings: AppSettings) => void) => () => void
  }
  auth: {
    getStatus: () => Promise<AuthStatus>
    login: () => Promise<AuthStatus>
    logout: () => Promise<AuthStatus>
    onChange: (callback: (status: AuthStatus) => void) => () => void
  }
  courses: {
    list: () => Promise<CourseSummary[]>
  }
  materials: {
    list: () => Promise<MaterialFile[]>
    recentAdded: (courseId: number | null) => Promise<RecentAddedFile[]>
    open: (relativePath: string, mode?: 'default' | 'folder') => Promise<void>
    preview: (relativePath: string) => Promise<void>
  }
  sync: {
    start: (options?: SyncOptions) => Promise<SyncResult>
    listUnselectedCourseFolders: (courseIds: number[]) => Promise<CourseFolderToDelete[]>
    stop: () => Promise<boolean>
    chooseFreshLocation: () => Promise<string | null>
    getStatus: () => Promise<SyncProgress>
    onProgress: (callback: (progress: SyncProgress) => void) => () => void
  }
  updates: {
    check: () => Promise<void>
    download: () => Promise<void>
    cancelDownload: () => Promise<void>
    install: () => Promise<void>
    openSecuritySettings: () => Promise<void>
    onChange: (callback: (status: AppUpdateStatus) => void) => () => void
  }
}
