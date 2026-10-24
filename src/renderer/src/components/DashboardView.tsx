import type { JSX } from 'react'
import { useAppStore } from '../store'
import { courseColor, formatDateTime, initials, pluralize } from '../utils'
import {
  AlertIcon,
  BookIcon,
  CheckIcon,
  ExternalIcon,
  FolderIcon,
  InfoIcon,
  SyncIcon
} from './Icons'
import { SyncCard } from './SyncCard'

export function DashboardView(): JSX.Element {
  const auth = useAppStore((state) => state.auth)
  const courses = useAppStore((state) => state.courses)
  const coursesLoading = useAppStore((state) => state.coursesLoading)
  const coursesError = useAppStore((state) => state.coursesError)
  const settings = useAppStore((state) => state.settings)
  const sync = useAppStore((state) => state.sync)
  const setView = useAppStore((state) => state.setView)
  const refreshCourses = useAppStore((state) => state.refreshCourses)
  const openVault = useAppStore((state) => state.openVault)
  const chooseVault = useAppStore((state) => state.chooseVault)
  const startSync = useAppStore((state) => state.startSync)

  const firstName = auth?.user?.fullname?.split(/\s+/)[0] || auth?.user?.username || 'studente'
  const preview = courses.slice(0, 5)

  return (
    <div className="view dashboard">
      <section className="hero-card">
        <div className="hero-card__copy">
          <span className="eyebrow">Ciao, {firstName}</span>
          <h2>Il tuo spazio UniPD è pronto.</h2>
          <p>
            {settings?.syncAllCourses
              ? `Stai sincronizzando tutti i ${courses.length > 0 ? courses.length : ''} corsi attivi.`
              : `Stai sincronizzando ${pluralize(settings?.selectedCourseIds.length ?? 0, 'corso selezionato', 'corsi selezionati')}.`}
          </p>
          <div className="hero-card__actions">
            <button
              type="button"
              className="button button--light"
              onClick={() => void startSync({ reason: 'manual' })}
              disabled={sync.running}
            >
              <SyncIcon className={sync.running ? 'spin' : undefined} />
              {sync.running ? 'Sincronizzazione…' : 'Sincronizza ora'}
            </button>
            <button
              type="button"
              className="button button--ghost-light"
              onClick={() => setView('courses')}
            >
              <BookIcon />
              Gestisci corsi
            </button>
          </div>
        </div>
        <div className="hero-card__stats">
          <div>
            <strong>{coursesLoading ? '—' : courses.length}</strong>
            <span>Corsi</span>
          </div>
          <div>
            <strong>{sync.downloaded}</strong>
            <span>Scaricati ora</span>
          </div>
          <div>
            <strong>{sync.removed}</strong>
            <span>Rimossi</span>
          </div>
        </div>
        <span className="hero-card__orb hero-card__orb--one" />
        <span className="hero-card__orb hero-card__orb--two" />
      </section>

      <SyncCard />

      <div className="dashboard-grid">
        <section className="card vault-card">
          <div className="card__header">
            <div>
              <span className="eyebrow">Vault Obsidian</span>
              <h2>Destinazione locale</h2>
            </div>
            <span className="icon-badge">
              <FolderIcon />
            </span>
          </div>
          <p className="vault-card__path" title={settings?.vaultPath}>
            {settings?.vaultPath}
          </p>
          <p className="muted">
            Qui troverai una cartella per corso, gli indici e le schede dei file.
          </p>
          <div className="button-row">
            <button type="button" className="button button--secondary" onClick={() => void openVault()}>
              <ExternalIcon />
              Apri vault
            </button>
            <button type="button" className="button button--ghost" onClick={() => void chooseVault()}>
              Cambia
            </button>
          </div>
        </section>

        <section className="card courses-preview">
          <div className="card__header">
            <div>
              <span className="eyebrow">Corsi</span>
              <h2>Materiali monitorati</h2>
            </div>
            <button type="button" className="text-button" onClick={() => setView('courses')}>
              Vedi tutti
            </button>
          </div>

          {coursesLoading ? (
            <div className="skeleton-list">
              <span />
              <span />
              <span />
            </div>
          ) : coursesError ? (
            <div className="empty-inline">
              <AlertIcon />
              <p>{coursesError}</p>
              <button type="button" className="button button--ghost" onClick={() => void refreshCourses()}>
                Riprova
              </button>
            </div>
          ) : preview.length === 0 ? (
            <div className="empty-inline">
              <BookIcon />
              <p>Nessun corso trovato nel tuo profilo Moodle.</p>
              <button type="button" className="button button--ghost" onClick={() => void refreshCourses()}>
                Aggiorna
              </button>
            </div>
          ) : (
            <ul className="course-mini-list">
              {preview.map((course) => (
                <li key={course.id}>
                  <span
                    className="course-dot"
                    style={{ background: courseColor(course.id) }}
                    aria-hidden="true"
                  >
                    {initials(course.displayName)}
                  </span>
                  <span className="course-mini-list__copy">
                    <strong>{course.displayName}</strong>
                    <small>{course.shortname}</small>
                  </span>
                  <CheckIcon className="course-mini-list__check" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="info-banner">
        <span className="info-banner__icon">
          <InfoIcon />
        </span>
        <div>
          <strong>I file rimossi da Moodle restano nel vault</strong>
          <p>
            Vengono marcati con <code>#rimosso-da-moodle</code>, la data di rimozione
            e una scheda dedicata. Nessuna cancellazione silenziosa.
          </p>
        </div>
        <span className="info-banner__meta">
          Ultimo controllo
          <strong>{formatDateTime(settings?.lastSyncAt ?? null)}</strong>
        </span>
      </section>
    </div>
  )
}
