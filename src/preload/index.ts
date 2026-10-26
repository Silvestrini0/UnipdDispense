import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type DesktopApi } from '../shared/ipc'
import type {
  AppSettings,
  AuthStatus,
  SyncProgress
} from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: DesktopApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IPC.appInfo),
    getSnapshot: () => ipcRenderer.invoke(IPC.appSnapshot),
    openVault: () => ipcRenderer.invoke(IPC.appOpenVault),
    quit: () => ipcRenderer.invoke(IPC.appQuit)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    chooseVault: () => ipcRenderer.invoke(IPC.settingsChooseVault),
    onChange: (callback) =>
      subscribe<AppSettings>(IPC.settingsChanged, callback)
  },
  auth: {
    getStatus: () => ipcRenderer.invoke(IPC.authStatus),
    login: () => ipcRenderer.invoke(IPC.authLogin),
    logout: () => ipcRenderer.invoke(IPC.authLogout),
    onChange: (callback) =>
      subscribe<AuthStatus>(IPC.authChanged, callback)
  },
  courses: {
    list: () => ipcRenderer.invoke(IPC.coursesList)
  },
  materials: {
    list: () => ipcRenderer.invoke(IPC.materialsList),
    recentAdded: (courseId) => ipcRenderer.invoke(IPC.materialsRecentAdded, courseId),
    open: (relativePath, mode = 'default') =>
      ipcRenderer.invoke(IPC.materialsOpen, relativePath, mode),
    preview: (relativePath) => ipcRenderer.invoke(IPC.materialsPreview, relativePath)
  },
  sync: {
    start: (options) => ipcRenderer.invoke(IPC.syncStart, options),
    listUnselectedCourseFolders: (courseIds) =>
      ipcRenderer.invoke(IPC.syncListUnselectedCourseFolders, courseIds),
    stop: () => ipcRenderer.invoke(IPC.syncStop),
    chooseFreshLocation: () => ipcRenderer.invoke(IPC.syncChooseFreshLocation),
    getStatus: () => ipcRenderer.invoke(IPC.syncStatus),
    onProgress: (callback) =>
      subscribe<SyncProgress>(IPC.syncProgress, callback)
  }
}

contextBridge.exposeInMainWorld('api', api)
