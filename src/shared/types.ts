export const APP_NAME = 'UnipdDispense'
export const APP_ID = 'com.moodlescraper.app'
export const MOODLE_BASE_URL = 'https://elearning.unipd.it/dlm'
export const MOODLE_AUTH_PARTITION = 'persist:moodle-auth'
export const AUTH_URL_SCHEME = 'moodle-vault'
export const THEME_MODES = ['light', 'dark'] as const
export const ACCENT_COLORS = ['blue', 'green', 'pink', 'purple', 'orange', 'yellow', 'teal'] as const

export type ThemeMode = (typeof THEME_MODES)[number]
export type AccentColor = (typeof ACCENT_COLORS)[number]

export interface MoodlePlatform {
  id: string
  label: string
  url: string
}

export const MOODLE_PLATFORMS: MoodlePlatform[] = [
  { id: 'stem', label: 'STEM (Ingegneria e Scienze)', url: 'https://stem.elearning.unipd.it' },
  { id: 'dlm', label: 'Didattica centrale (DLM)', url: 'https://elearning.unipd.it/dlm' },
  {
    id: 'samv',
    label: 'Agraria e Medicina Veterinaria',
    url: 'https://samv.elearning.unipd.it'
  },
  {
    id: 'sesp',
    label: 'Economia e Scienze Politiche',
    url: 'https://sesp.elearning.unipd.it'
  },
  { id: 'giuri', label: 'Giurisprudenza', url: 'https://giuri.elearning.unipd.it' },
  { id: 'medicina', label: 'Medicina e Chirurgia', url: 'https://medicina.elearning.unipd.it' },
  { id: 'psico', label: 'Psicologia', url: 'https://psico.elearning.unipd.it' },
  {
    id: 'ssu',
    label: 'Scienze Umane e patrimonio culturale',
    url: 'https://ssu.elearning.unipd.it'
  },
  { id: 'sba', label: 'Sistema Bibliotecario di Ateneo', url: 'https://elearning.unipd.it/sba' },
  { id: 'esami', label: 'Piattaforma Esami', url: 'https://esami.unipd.it' }
]

export function moodlePlatformLabel(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '').toLowerCase()
  const platform = MOODLE_PLATFORMS.find(
    (candidate) => candidate.url.replace(/\/+$/, '').toLowerCase() === normalized
  )
  if (platform) {
    return platform.label
  }
  try {
    return new URL(baseUrl).hostname
  } catch {
    return baseUrl
  }
}

export type SecureStorageState = 'secure' | 'basic-text' | 'unavailable'

export type AuthState =
  | 'unknown'
  | 'signed-out'
  | 'signing-in'
  | 'authenticated'
  | 'error'

export interface AuthUser {
  id: number
  username: string
  fullname: string
  siteName: string
  siteUrl: string
}

export interface AuthStatus {
  state: AuthState
  user: AuthUser | null
  secureStorage: SecureStorageState
  error?: string
}

export interface AppSettings {
  vaultPath: string
  moodleBaseUrl: string
  themeMode: ThemeMode
  accentColor: AccentColor
  personalizationCompleted: boolean
  syncIntervalMinutes: number
  autoSync: boolean
  autoUpdates: boolean
  launchAtLogin: boolean
  syncAllCourses: boolean
  selectedCourseIds: number[]
  lastSyncAt: string | null
}

export type SettingsPatch = Partial<
  Pick<
    AppSettings,
    | 'vaultPath'
    | 'moodleBaseUrl'
    | 'themeMode'
    | 'accentColor'
    | 'personalizationCompleted'
    | 'syncIntervalMinutes'
    | 'autoSync'
    | 'autoUpdates'
    | 'launchAtLogin'
    | 'syncAllCourses'
    | 'selectedCourseIds'
    | 'lastSyncAt'
  >
>

export interface CourseSummary {
  id: number
  fullname: string
  shortname: string
  displayName: string
  category: number
  visible: boolean
  startDate: number | null
  endDate: number | null
  summary: string
}

export type SyncPhase =
  | 'idle'
  | 'scanning'
  | 'downloading'
  | 'finalizing'
  | 'paused'
  | 'completed'
  | 'error'

export interface SyncProgress {
  running: boolean
  phase: SyncPhase
  message: string
  courseId: number | null
  courseName: string | null
  currentFile: string | null
  processed: number
  total: number
  downloaded: number
  skipped: number
  removed: number
  backedUp: number
  localChanges: number
  errors: number
  startedAt: string | null
  finishedAt: string | null
}

export interface SyncOptions {
  courseIds?: number[]
  deleteCourseIds?: number[]
  reason?: 'manual' | 'scheduled' | 'startup'
  freshCopyRoot?: string
}

export interface CourseFolderToDelete {
  courseId: number
  courseName: string
  courseFolder: string
}

export interface SyncIssue {
  path: string
  message: string
}

export interface SyncResult {
  downloaded: number
  skipped: number
  removed: number
  backedUp: number
  localChanges: number
  errors: SyncIssue[]
  courses: number
  deletedCourses?: number
  finishedAt: string
  paused?: boolean
}

export type MaterialCategory = 'material' | 'info'
export type MaterialStatus = 'present' | 'removed'
export type MaterialKind = 'file' | 'note'

export interface MaterialFile {
  relativePath: string
  filename: string
  courseFolder: string
  category: MaterialCategory
  sectionFolder: string
  moduleFolder: string
  extension: string
  mimeType: string
  size: number
  modifiedAt: string
  moodleModifiedAt: string | null
  status: MaterialStatus
  kind: MaterialKind
  managed: boolean
}

export interface RecentAddedFile {
  courseId: number
  courseName: string
  filename: string
  relativePath: string
  sectionName: string
  moduleName: string
  moodleAddedAt: string | null
  detectedAt: string
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  secureStorage: SecureStorageState
  userDataPath: string
}

export type UpdateState =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface AppUpdateStatus {
  supported: boolean
  state: UpdateState
  currentVersion: string
  availableVersion: string | null
  percent: number
  error: string | null
}

export interface AppSnapshot {
  info: AppInfo
  settings: AppSettings
  update: AppUpdateStatus
  auth: AuthStatus
  sync: SyncProgress
  courses: CourseSummary[]
}

export interface SyncProgressEvent {
  progress: SyncProgress
}
