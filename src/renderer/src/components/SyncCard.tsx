import type { JSX } from 'react'
import { useAppStore } from '../store'
import { formatDateTime, phaseLabel } from '../utils'
import { AlertIcon, CheckIcon, ClockIcon, SyncIcon } from './Icons'

export function SyncCard(): JSX.Element {
  const sync = useAppStore((state) => state.sync)
  const settings = useAppStore((state) => state.settings)
  const auth = useAppStore((state) => state.auth)
  const stopSync = useAppStore((state) => state.stopSync)
  const startSync = useAppStore((state) => state.startSync)
  const startFreshSync = useAppStore((state) => state.startFreshSync)
  const hasSelection =
    Boolean(settings?.syncAllCourses) || (settings?.selectedCourseIds.length ?? 0) > 0
  const percent =
    sync.total > 0 ? Math.min(100, Math.round((sync.processed / sync.total) * 100)) : 0
  const errored = sync.phase === 'error' || sync.errors > 0
  const complete = sync.phase === 'completed'

  return (
    <section className={`card sync-card ${sync.running ? 'sync-card--running' : ''}`}>
      <div className="card__header">
        <div>
          <span className="eyebrow">Sincronizzazione</span>
          <h2>{sync.running ? phaseLabel(sync.phase) : 'Stato dei materiali'}</h2>
        </div>
        <span className={`status-pill ${sync.running ? 'status-pill--busy' : ''}`}>
          <span className="status-pill__dot" />
          {sync.running
            ? 'In corso'
            : sync.phase === 'paused'
              ? 'Fermata'
              : complete
                ? 'Completata'
                : 'In attesa'}
        </span>
      </div>

      <p className={`sync-card__message ${errored ? 'text-danger' : ''}`}>
        {errored ? (
          <AlertIcon />
        ) : complete ? (
          <CheckIcon />
        ) : sync.running ? (
          <SyncIcon className="spin" />
        ) : (
          <ClockIcon />
        )}
        <span>{sync.message}</span>
      </p>

      {(sync.running || sync.total > 0) && (
        <div className="progress-block">
          <div className="progress-block__meta">
            <span>
              {sync.total > 0
                ? `${sync.processed} di ${sync.total} file`
                : 'Preparazione…'}
            </span>
            <span>{sync.total > 0 ? `${percent}%` : '—'}</span>
          </div>
          <div
            className={`progress ${sync.running && sync.total === 0 ? 'progress--indeterminate' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${sync.total > 0 ? percent : 12}%` }} />
          </div>
          {sync.currentFile && (
            <p className="progress-block__file" title={sync.currentFile}>
              {sync.currentFile}
            </p>
          )}
        </div>
      )}

      <div className="sync-card__actions">
        {sync.running && sync.phase !== 'finalizing' && (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void stopSync()}
          >
            Ferma sincronizzazione
          </button>
        )}
        {sync.phase === 'paused' && (
          <button
            type="button"
            className="button button--primary"
            onClick={() => void startSync({ reason: 'manual' })}
          >
            Riprendi da dove si è fermata
          </button>
        )}
        <button
          type="button"
          className="button button--ghost"
          onClick={() => void startFreshSync()}
          disabled={sync.running || auth?.state !== 'authenticated' || !hasSelection}
          title={
            auth?.state !== 'authenticated'
              ? 'Accedi a Moodle per scaricare i materiali'
              : !hasSelection
                ? 'Seleziona almeno un corso'
                : undefined
          }
        >
          Riscarica i corsi selezionati in una nuova cartella
        </button>
      </div>

      <div className="stat-grid stat-grid--compact">
        <div className="stat">
          <strong>{sync.downloaded}</strong>
          <span>Scaricati</span>
        </div>
        <div className="stat">
          <strong>{sync.skipped}</strong>
          <span>Invariati</span>
        </div>
        <div className="stat">
          <strong>{sync.removed}</strong>
          <span>Rimossi</span>
        </div>
        <div className={`stat ${sync.errors > 0 ? 'stat--danger' : ''}`}>
          <strong>{sync.errors}</strong>
          <span>Errori</span>
        </div>
      </div>

      <p className="sync-card__safety">
        {sync.backedUp} copie di sicurezza · {sync.localChanges} modifiche locali mantenute.
        {' '}Le versioni salvate sono in <code>.moodlescraper/backups</code> nel vault.
        {' '}Una copia completa crea una nuova cartella e lascia intatto il vault attuale.
      </p>

      <div className="sync-card__footer">
        <span>
          <ClockIcon />
          Ultima sync: {formatDateTime(settings?.lastSyncAt ?? null)}
        </span>
        <span>
          {settings?.autoSync
            ? `Controllo ogni ${settings.syncIntervalMinutes} minuti`
            : 'Controllo automatico disattivato'}
        </span>
      </div>
    </section>
  )
}
