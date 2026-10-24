import type { JSX } from 'react'
import { useAppStore, type View } from '../store'
import { formatDateTime, initials } from '../utils'
import {
  BookIcon,
  DashboardIcon,
  LogoutIcon,
  FileIcon,
  PowerIcon,
  SettingsIcon,
  SyncIcon
} from './Icons'
import { Logo } from './Logo'

const navigation: Array<{
  id: View
  label: string
  icon: typeof DashboardIcon
}> = [
  { id: 'dashboard', label: 'Panoramica', icon: DashboardIcon },
  { id: 'courses', label: 'Corsi', icon: BookIcon },
  { id: 'materials', label: 'Materiali', icon: FileIcon },
  { id: 'settings', label: 'Impostazioni', icon: SettingsIcon }
]

export function Sidebar(): JSX.Element {
  const view = useAppStore((state) => state.view)
  const setView = useAppStore((state) => state.setView)
  const auth = useAppStore((state) => state.auth)
  const courses = useAppStore((state) => state.courses)
  const sync = useAppStore((state) => state.sync)
  const settings = useAppStore((state) => state.settings)
  const logout = useAppStore((state) => state.logout)
  const quit = useAppStore((state) => state.quit)

  return (
    <aside className="sidebar">
      <div className="sidebar__top">
        <Logo />
        <nav className="nav" aria-label="Navigazione principale">
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                className={`nav__item ${view === item.id ? 'nav__item--active' : ''}`}
                onClick={() => setView(item.id)}
              >
                <Icon />
                <span>{item.label}</span>
                {item.id === 'courses' && courses.length > 0 && (
                  <span className="nav__badge">{courses.length}</span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="sidebar__bottom">
        <div className={`sync-indicator ${sync.running ? 'sync-indicator--active' : ''}`}>
          <span className="sync-indicator__dot" />
          <span className="sync-indicator__copy">
            <strong>{sync.running ? 'Sincronizzazione…' : 'Controllo automatico'}</strong>
            <span>
              {sync.running
                ? sync.message
                : settings?.autoSync
                  ? `Ogni ${settings.syncIntervalMinutes} minuti`
                  : 'Disattivato'}
            </span>
          </span>
        </div>

        <div className="account-card">
          <span className="avatar">{initials(auth?.user?.fullname || 'Studente')}</span>
          <span className="account-card__copy">
            <strong>{auth?.user?.fullname || 'Studente UniPD'}</strong>
            <span>Ultima sync: {formatDateTime(settings?.lastSyncAt ?? null)}</span>
          </span>
        </div>

        <div className="sidebar__actions">
          <button type="button" className="sidebar-action" onClick={() => void logout()}>
            <LogoutIcon />
            Disconnetti
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => void quit()}
            aria-label="Esci dall’applicazione"
            title="Esci"
          >
            <PowerIcon />
          </button>
        </div>
        <div className="sidebar__hint">
          <SyncIcon />
          <span>La finestra può restare chiusa: l’app continua dal tray.</span>
        </div>
      </div>
    </aside>
  )
}
