import { create } from 'zustand'
import type {
  AppInfo,
  AppSettings,
  AppUpdateStatus,
  AuthStatus,
  CourseSummary,
  MaterialFile,
  SettingsPatch,
  SyncOptions,
  SyncProgress
} from '../../shared/types'

export type View = 'dashboard' | 'courses' | 'materials' | 'settings'

export type NoticeKind = 'success' | 'error' | 'info'

export interface Notice {
  id: number
  kind: NoticeKind
  message: string
}

interface AppStore {
  initialized: boolean
  info: AppInfo | null
  settings: AppSettings | null
  auth: AuthStatus | null
  sync: SyncProgress
  update: AppUpdateStatus
  courses: CourseSummary[]
  coursesLoading: boolean
  coursesError: string | null
  materials: MaterialFile[]
  materialsLoading: boolean
  materialsError: string | null
  loginBusy: boolean
  settingsSaving: boolean
  view: View
  notice: Notice | null
  initialize: () => Promise<void>
  setView: (view: View) => void
  refreshCourses: () => Promise<void>
  refreshMaterials: () => Promise<void>
  openMaterial: (relativePath: string, mode?: 'default' | 'folder') => Promise<void>
  previewMaterial: (relativePath: string) => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
  saveSettings: (patch: SettingsPatch) => Promise<void>
  chooseVault: () => Promise<void>
  startSync: (options?: SyncOptions) => Promise<void>
  stopSync: () => Promise<void>
  startFreshSync: () => Promise<void>
  openVault: () => Promise<void>
  quit: () => Promise<void>
  checkForUpdate: () => Promise<void>
  downloadUpdate: () => Promise<void>
  cancelUpdateDownload: () => Promise<void>
  installUpdate: () => Promise<void>
  openUpdateSecuritySettings: () => Promise<void>
  dismissNotice: () => void
}

const emptySync: SyncProgress = {
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

let initialization: Promise<void> | null = null
let subscribed = false
let noticeCounter = 0

export const useAppStore = create<AppStore>((set, get) => ({
  initialized: false,
  info: null,
  settings: null,
  auth: null,
  sync: emptySync,
  update: {
    supported: false,
    state: 'unsupported',
    currentVersion: '',
    availableVersion: null,
    percent: 0,
    error: null
  },
  courses: [],
  coursesLoading: false,
  coursesError: null,
  materials: [],
  materialsLoading: false,
  materialsError: null,
  loginBusy: false,
  settingsSaving: false,
  view: 'dashboard',
  notice: null,

  initialize: async () => {
    if (initialization) {
      return initialization
    }
    initialization = (async () => {
      subscribeToEvents(set, get)
      try {
        const snapshot = await window.api.app.getSnapshot()
        set({
          info: snapshot.info,
          settings: snapshot.settings,
          update: snapshot.update,
          auth: snapshot.auth,
          sync: snapshot.sync,
          initialized: true,
          loginBusy: snapshot.auth.state === 'signing-in'
        })
        if (snapshot.auth.state === 'authenticated') {
          void get().refreshCourses()
        } else if (snapshot.auth.state === 'unknown') {
          pollAuthentication(set, get)
        }
      } catch (error) {
        set({
          initialized: true,
          notice: makeNotice('error', messageFrom(error))
        })
      }
    })()
    return initialization
  },

  setView: (view) => {
    set({ view })
    if (view === 'materials') void get().refreshMaterials()
  },

  refreshCourses: async () => {
    if (get().auth?.state !== 'authenticated') {
      set({ courses: [], coursesLoading: false })
      return
    }
    set({ coursesLoading: true, coursesError: null })
    try {
      const courses = await window.api.courses.list()
      set({ courses, coursesLoading: false })
    } catch (error) {
      set({
        courses: [],
        coursesLoading: false,
        coursesError: messageFrom(error)
      })
    }
  },

  refreshMaterials: async () => {
    set({ materialsLoading: true, materialsError: null })
    try {
      const materials = await window.api.materials.list()
      set({ materials, materialsLoading: false })
    } catch (error) {
      set({ materials: [], materialsLoading: false, materialsError: messageFrom(error) })
    }
  },

  openMaterial: async (relativePath, mode = 'default') => {
    try {
      await window.api.materials.open(relativePath, mode)
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  previewMaterial: async (relativePath) => {
    try {
      await window.api.materials.preview(relativePath)
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  login: async () => {
    set({ loginBusy: true })
    try {
      const status = await window.api.auth.login()
      let appearanceResetError: string | null = null
      if (status.state === 'authenticated') {
        const currentSettings = get().settings
        if (currentSettings) {
          set({
            settings: { ...currentSettings, personalizationCompleted: false },
            settingsSaving: true
          })
          try {
            const settings = await window.api.settings.update({ personalizationCompleted: false })
            set({ settings, settingsSaving: false })
          } catch (error) {
            appearanceResetError = messageFrom(error)
            set({ settingsSaving: false })
          }
        }
      }
      set({
        auth: status,
        loginBusy: false,
        notice:
          status.state === 'authenticated'
            ? appearanceResetError
              ? makeNotice(
                  'error',
                  `Accesso completato, ma non è stato possibile aggiornare le preferenze: ${appearanceResetError}`
                )
              : makeNotice('success', 'Accesso a Moodle completato.')
            : status.error
              ? makeNotice('error', status.error)
              : null
      })
      if (status.state === 'authenticated') {
        await get().refreshCourses()
      }
    } catch (error) {
      set({
        loginBusy: false,
        notice: makeNotice('error', messageFrom(error))
      })
    }
  },

  logout: async () => {
    try {
      const status = await window.api.auth.logout()
      set({
        auth: status,
        courses: [],
        coursesError: null,
        notice: makeNotice('info', 'Disconnesso da Moodle.')
      })
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  saveSettings: async (patch) => {
    set({ settingsSaving: true })
    try {
      const settings = await window.api.settings.update(patch)
      set({ settings, settingsSaving: false })
    } catch (error) {
      set({
        settingsSaving: false,
        notice: makeNotice('error', messageFrom(error))
      })
    }
  },

  chooseVault: async () => {
    try {
      const vaultPath = await window.api.settings.chooseVault()
      if (vaultPath) {
        await get().saveSettings({ vaultPath })
      }
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  startSync: async (options) => {
    try {
      const result = await window.api.sync.start(options ?? { reason: 'manual' })
      const status = await window.api.sync.getStatus()
      const noCourses = result.courses === 0
      const activeSettings = options?.freshCopyRoot
        ? await window.api.settings.get().catch(() => null)
        : null
      const resultMessage = result.paused
        ? `Sincronizzazione fermata in sicurezza: ${result.downloaded} file completati. Puoi riprenderla quando vuoi.`
        : noCourses
          ? 'Nessun corso trovato su questa piattaforma. Se i tuoi corsi sono altrove, cambia piattaforma nella schermata di accesso (es. STEM).'
          : `Sync completata: ${result.downloaded} scaricati, ${result.skipped} invariati, ${result.removed} rimossi${result.deletedCourses ? `, ${result.deletedCourses} cartelle di corsi eliminate` : ''}${result.backedUp > 0 ? `, ${result.backedUp} copie di sicurezza` : ''}${result.localChanges > 0 ? `, ${result.localChanges} modifiche locali mantenute` : ''}${result.errors.length > 0 ? `, ${result.errors.length} errori` : ''}.`
      const noticeMessage = options?.freshCopyRoot
        ? `Nuova cartella: ${activeSettings?.vaultPath ?? 'creata'}. Il vault precedente è rimasto intatto. ${resultMessage}`
        : resultMessage
      set({
        sync: status,
        ...(activeSettings ? { settings: activeSettings } : {}),
        notice: makeNotice(
          result.paused
            ? 'info'
            : noCourses
              ? 'info'
              : result.errors.length > 0 || result.localChanges > 0
                ? 'info'
                : 'success',
          noticeMessage
        )
      })
      if (result.courses > 0 && !result.paused) await get().refreshMaterials()
    } catch (error) {
      const status = await window.api.sync.getStatus().catch(() => null)
      const auth = await window.api.auth.getStatus().catch(() => null)
      set({
        ...(status ? { sync: status } : {}),
        ...(auth ? { auth } : {}),
        notice: makeNotice('error', messageFrom(error))
      })
    }
  },

  stopSync: async () => {
    try {
      await window.api.sync.stop()
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  startFreshSync: async () => {
    try {
      const freshCopyRoot = await window.api.sync.chooseFreshLocation()
      if (!freshCopyRoot) return
      if (get().sync.running) {
        set({ notice: makeNotice('info', 'La sincronizzazione è già in corso. Fermala prima di avviare una nuova copia.') })
        return
      }
      await get().startSync({ reason: 'manual', freshCopyRoot })
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  openVault: async () => {
    try {
      await window.api.app.openVault()
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  quit: async () => {
    try {
      await window.api.app.quit()
    } catch {
      return
    }
  },

  checkForUpdate: async () => {
    try {
      await window.api.updates.check()
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  downloadUpdate: async () => {
    try {
      await window.api.updates.download()
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  cancelUpdateDownload: async () => {
    try {
      await window.api.updates.cancelDownload()
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  installUpdate: async () => {
    if (get().sync.running) {
      set({ notice: makeNotice('info', 'Attendi il completamento della sincronizzazione prima di installare l’aggiornamento.') })
      return
    }
    try {
      await window.api.updates.install()
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  openUpdateSecuritySettings: async () => {
    try {
      await window.api.updates.openSecuritySettings()
    } catch (error) {
      set({ notice: makeNotice('error', messageFrom(error)) })
    }
  },

  dismissNotice: () => set({ notice: null })
}))

function subscribeToEvents(
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore
): void {
  if (subscribed) {
    return
  }
  subscribed = true
  window.api.auth.onChange((status) => {
    set({
      auth: status,
      loginBusy: status.state === 'signing-in'
    })
    if (status.state === 'authenticated') {
      if (get().courses.length === 0) {
        void get().refreshCourses()
      }
    } else if (status.state === 'signed-out' || status.state === 'error') {
      set({ courses: [], coursesLoading: false })
    }
  })
  window.api.settings.onChange((settings) => {
    set({ settings })
  })
  window.api.sync.onProgress((sync) => {
    set({ sync })
    if (sync.phase === 'completed' || sync.phase === 'paused') {
      void get().refreshMaterials()
    }
  })
  window.api.updates.onChange((update) => {
    set({ update })
  })
}

function pollAuthentication(
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore
): void {
  let attempts = 0
  const tick = async (): Promise<void> => {
    attempts += 1
    try {
      const status = await window.api.auth.getStatus()
      set({ auth: status })
      if (status.state === 'authenticated') {
        await get().refreshCourses()
        return
      }
      if (status.state === 'unknown' && attempts < 40) {
        window.setTimeout(() => {
          void tick()
        }, 750)
      } else if (status.state === 'unknown') {
        set({
          auth: {
            ...status,
            state: 'signed-out',
            error: 'Verifica della sessione non completata. Accedi di nuovo.'
          }
        })
      }
    } catch {
      if (attempts < 40) {
        window.setTimeout(() => {
          void tick()
        }, 1000)
      }
    }
  }
  window.setTimeout(() => {
    void tick()
  }, 500)
}

function makeNotice(kind: NoticeKind, message: string): Notice {
  noticeCounter += 1
  return { id: noticeCounter, kind, message }
}

function messageFrom(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
}
