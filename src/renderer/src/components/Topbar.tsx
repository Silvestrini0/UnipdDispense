import type { JSX } from 'react'
import { useAppStore } from '../store'
import { FolderIcon, SyncIcon } from './Icons'

const copy: Record<
  'dashboard' | 'courses' | 'materials' | 'settings',
  { title: string; subtitle: string }
> = {
  dashboard: {
    title: 'Panoramica',
    subtitle: 'Lo stato dei tuoi materiali UniPD'
  },
  courses: {
    title: 'Corsi',
    subtitle: 'Scegli cosa includere nella sincronizzazione'
  },
  materials: {
    title: 'Materiali',
    subtitle: 'Appunti e risorse organizzati per corso'
  },
  settings: {
    title: 'Impostazioni',
    subtitle: 'Vault, credenziali e comportamento dell’app'
  }
}

export function Topbar(): JSX.Element {
  const view = useAppStore((state) => state.view)
  const sync = useAppStore((state) => state.sync)
  const settings = useAppStore((state) => state.settings)
  const startSync = useAppStore((state) => state.startSync)
  const openVault = useAppStore((state) => state.openVault)
  const hasSelection =
    Boolean(settings?.syncAllCourses) || (settings?.selectedCourseIds.length ?? 0) > 0

  return (
    <header className="topbar">
      <div className="topbar__copy">
        <h1>{copy[view].title}</h1>
        <p>{copy[view].subtitle}</p>
      </div>
      <div className="topbar__actions">
        <button
          type="button"
          className="button button--ghost button--icon-mobile"
          onClick={() => void openVault()}
          title="Apri il vault Obsidian"
        >
          <FolderIcon />
          <span>Apri vault</span>
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void startSync({ reason: 'manual' })}
          disabled={sync.running || !hasSelection}
          title={!hasSelection ? 'Seleziona almeno un corso' : undefined}
        >
          <SyncIcon className={sync.running ? 'spin' : undefined} />
          <span>{sync.running ? 'Sincronizzazione…' : 'Sincronizza ora'}</span>
        </button>
      </div>
    </header>
  )
}
