import { useEffect, type JSX } from 'react'
import { CoursesView } from './components/CoursesView'
import { DashboardView } from './components/DashboardView'
import { LoginView } from './components/LoginView'
import { MaterialsView } from './components/MaterialsView'
import { Logo } from './components/Logo'
import { Notice } from './components/Notice'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { useAppStore } from './store'

export default function App(): JSX.Element {
  const initialized = useAppStore((state) => state.initialized)
  const auth = useAppStore((state) => state.auth)
  const view = useAppStore((state) => state.view)
  const notice = useAppStore((state) => state.notice)
  const dismissNotice = useAppStore((state) => state.dismissNotice)
  const initialize = useAppStore((state) => state.initialize)

  useEffect(() => {
    void initialize()
  }, [initialize])

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
        <Notice />
      </>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        <Topbar />
        <div className="main__content">
          {view === 'dashboard' && <DashboardView />}
          {view === 'courses' && <CoursesView />}
          {view === 'materials' && <MaterialsView />}
          {view === 'settings' && <SettingsView />}
        </div>
      </main>
      <Notice />
    </div>
  )
}
