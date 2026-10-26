import type { JSX } from 'react'
import { useAppStore } from '../store'
import { DownloadIcon, FolderIcon, SyncIcon } from './Icons'

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
  const update = useAppStore((state) => state.update)
  const settings = useAppStore((state) => state.settings)
  const startSync = useAppStore((state) => state.startSync)
  const openVault = useAppStore((state) => state.openVault)
  const checkForUpdate = useAppStore((state) => state.checkForUpdate)
  const downloadUpdate = useAppStore((state) => state.downloadUpdate)
  const installUpdate = useAppStore((state) => state.installUpdate)
  const hasSelection =
    Boolean(settings?.syncAllCourses) || (settings?.selectedCourseIds.length ?? 0) > 0
  const updateLabel =
    update.state === 'checking'
      ? 'Controllo aggiornamenti…'
      : update.state === 'available'
        ? `Aggiorna alla versione ${update.availableVersion}`
        : update.state === 'downloading'
          ? `Scaricamento ${Math.round(update.percent)}%`
          : update.state === 'downloaded'
            ? 'Riavvia e installa'
            : update.state === 'error'
              ? 'Riprova aggiornamento'
              : 'Controlla aggiornamenti'
  const updateBusy = update.state === 'checking' || update.state === 'downloading'

  const handleUpdateAction = (): void => {
    if (update.state === 'available') {
      void downloadUpdate()
    } else if (update.state === 'downloaded') {
      void installUpdate()
    } else if (update.state === 'error' && update.availableVersion) {
      void downloadUpdate()
    } else {
      void checkForUpdate()
    }
  }

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
        {update.supported && (
          <button
            type="button"
            className="button button--update"
            onClick={handleUpdateAction}
            disabled={updateBusy}
            title={update.error ?? updateLabel}
          >
            <DownloadIcon />
            <span>{updateLabel}</span>
          </button>
        )}
        <button
          type="button"
          className="button button--primary"
          onClick={() => void startSync({ reason: 'manual' })}
          disabled={sync.running || !hasSelection}
          title={!hasSelection ? 'Seleziona almeno un corso' : undefined}
        >
          <SyncIcon className={sync.running ? 'spin' : undefined} />
          <span>
            {sync.running
              ? 'Sincronizzazione…'
              : sync.phase === 'paused'
                ? 'Riprendi sincronizzazione'
                : 'Sincronizza ora'}
          </span>
        </button>
      </div>
    </header>
  )
}
