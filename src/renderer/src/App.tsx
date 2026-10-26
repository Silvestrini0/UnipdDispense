import { useEffect, type JSX } from 'react'
import { CoursesView } from './components/CoursesView'
import { DashboardView } from './components/DashboardView'
import { AppearanceModal } from './components/AppearanceModal'
import { LoginView } from './components/LoginView'
import { MaterialsView } from './components/MaterialsView'
import { Logo } from './components/Logo'
import { Notice } from './components/Notice'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { UpdateBanner } from './components/UpdateBanner'
import { useAppStore } from './store'

export default function App(): JSX.Element {
  const initialized = useAppStore((state) => state.initialized)
  const auth = useAppStore((state) => state.auth)
  const settings = useAppStore((state) => state.settings)
  const view = useAppStore((state) => state.view)
  const notice = useAppStore((state) => state.notice)
  const dismissNotice = useAppStore((state) => state.dismissNotice)
  const initialize = useAppStore((state) => state.initialize)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings?.themeMode ?? 'light'
    root.dataset.accent = settings?.accentColor ?? 'blue'
    root.style.colorScheme = settings?.themeMode ?? 'light'
  }, [settings?.themeMode, settings?.accentColor])

  useEffect(() => {
    if (!notice) {
      return
    }
    const timer = window.setTimeout(() => dismissNotice(), 6500)
    return () => window.clearTimeout(timer)
  }, [notice, dismissNotice])

  if (!initialized || !auth || auth.state === 'unknown') {
    return (
      <div className="splash">
        <Logo />
        <div className="splash__loader" role="status" aria-live="polite">
          <span className="spinner" />
          <span>Verifica della sessione Moodle…</span>
        </div>
      </div>
    )
  }

  if (auth.state !== 'authenticated') {
    return (
      <>
        <LoginView />
        <UpdateBanner floating />
        <Notice />
      </>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        <Topbar />
        <UpdateBanner />
        <div className="main__content">
          {view === 'dashboard' && <DashboardView />}
          {view === 'courses' && <CoursesView />}
          {view === 'materials' && <MaterialsView />}
          {view === 'settings' && <SettingsView />}
        </div>
      </main>
      {settings && !settings.personalizationCompleted && (
        <AppearanceModal settings={settings} />
      )}
      <Notice />
    </div>
  )
}
