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
  const downloadUpdate = useAppStore((state) => state.downloadUpdate)
  const cancelUpdateDownload = useAppStore((state) => state.cancelUpdateDownload)
  const hasSelection =
    Boolean(settings?.syncAllCourses) || (settings?.selectedCourseIds.length ?? 0) > 0
  const showUpdateButton =
    update.state === 'available' ||
    update.state === 'downloading' ||
    update.state === 'canceling' ||
    (update.state === 'error' && update.availableVersion !== null)

  const handleUpdateAction = (): void => {
    if (update.state === 'downloading') {
      void cancelUpdateDownload()
    } else if (
      update.state === 'available' ||
      (update.state === 'error' && update.availableVersion)
    ) {
      void downloadUpdate()
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
        {update.supported && showUpdateButton && (
          <button
            type="button"
            className="button button--update button--update-icon"
            onClick={handleUpdateAction}
            disabled={update.state === 'canceling'}
            aria-label={
              update.state === 'downloading'
                ? 'Interrompi il download dell’aggiornamento'
                : update.state === 'canceling'
                  ? 'Interruzione del download in corso'
                  : 'Scarica aggiornamento'
            }
            aria-busy={update.state === 'downloading' || update.state === 'canceling'}
            title={
              update.state === 'downloading'
                ? `Interrompi il download (${Math.round(update.percent)}%)`
                : update.state === 'canceling'
                  ? 'Interruzione del download…'
                  : update.error ?? `Scarica la versione ${update.availableVersion}`
            }
          >
            <DownloadIcon />
          </button>
        )}
        <button
          type="button"
          className="button button--primary"
          onClick={() => void startSync({ reason: 'manual' })}
          disabled={sync.running || !hasSelection || update.state === 'installing'}
          title={
            !hasSelection
              ? 'Seleziona almeno un corso'
              : update.state === 'installing'
                ? 'Attendi il completamento dell’aggiornamento'
                : undefined
          }
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
