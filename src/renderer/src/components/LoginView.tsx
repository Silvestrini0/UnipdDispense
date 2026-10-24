import type { JSX } from 'react'
import {
  MOODLE_BASE_URL,
  MOODLE_PLATFORMS,
  moodlePlatformLabel
} from '../../../shared/types'
import { useAppStore } from '../store'
import { secureStorageLabel } from '../utils'
import { AlertIcon, CheckIcon, ShieldIcon, SyncIcon } from './Icons'
import { Logo } from './Logo'

export function LoginView(): JSX.Element {
  const auth = useAppStore((state) => state.auth)
  const settings = useAppStore((state) => state.settings)
  const login = useAppStore((state) => state.login)
  const loginBusy = useAppStore((state) => state.loginBusy)
  const saveSettings = useAppStore((state) => state.saveSettings)
  const secure = auth?.secureStorage === 'secure'
  const persistent = secure || auth?.secureStorage === 'basic-text'
  const busy = loginBusy || auth?.state === 'signing-in'

  return (
    <div className="login-shell">
      <section className="login-hero">
        <Logo />
        <div className="login-hero__body">
          <span className="eyebrow">UnipdDispense</span>
          <h1>
            I tuoi materiali,
            <br />
            <span>sempre in ordine.</span>
          </h1>
          <p>
            Accedi al Moodle di Ateneo e lascia che i file dei tuoi corsi arrivino
            nel vault Obsidian, senza duplicati e senza perdere traccia di quelli rimossi.
          </p>
          <ul className="feature-list">
            <li>
              <span className="feature-list__icon">
                <SyncIcon />
              </span>
              <span>
                <strong>Controllo automatico</strong>
                <small>Ogni 30 minuti, solo quando serve.</small>
              </span>
            </li>
            <li>
              <span className="feature-list__icon">
                <CheckIcon />
              </span>
              <span>
                <strong>Struttura ordinata</strong>
                <small>Corsi, sezioni e moduli nel tuo vault.</small>
              </span>
            </li>
            <li>
              <span className="feature-list__icon">
                <ShieldIcon />
              </span>
              <span>
                <strong>Accesso sicuro</strong>
                <small>Login con Single Sign-On di Ateneo.</small>
              </span>
            </li>
          </ul>
        </div>
        <footer className="login-hero__footer">
          Progetto non affiliato all’Università degli Studi di Padova.
        </footer>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="login-card__badge">
            <ShieldIcon />
            Accesso sicuro a Moodle
          </div>
          <h2>Accedi a UniPD</h2>
          <p className="muted">
            Scegli la piattaforma dei tuoi corsi e completa l’accesso nella finestra
            UniPD con Single Sign-On, SPID o CIE.
          </p>

          {auth?.error && (
            <div className="alert alert--error" role="alert">
              <AlertIcon />
              <span>{auth.error}</span>
            </div>
          )}

          <div className="login-form">
            <label className="field">
              <span>Piattaforma Moodle</span>
              <select
                className="select"
                value={settings?.moodleBaseUrl ?? MOODLE_BASE_URL}
                onChange={(event) =>
                  void saveSettings({ moodleBaseUrl: event.target.value })
                }
                disabled={busy}
                aria-label="Piattaforma Moodle"
              >
                {!MOODLE_PLATFORMS.some(
                  (platform) => platform.url === (settings?.moodleBaseUrl ?? MOODLE_BASE_URL)
                ) && (
                  <option value={settings?.moodleBaseUrl ?? MOODLE_BASE_URL}>
                    {moodlePlatformLabel(settings?.moodleBaseUrl ?? MOODLE_BASE_URL)}
                  </option>
                )}
                {MOODLE_PLATFORMS.map((platform) => (
                  <option key={platform.id} value={platform.url}>
                    {platform.label}
                  </option>
                ))}
              </select>
              <small className="muted">
                Scegli la piattaforma dei tuoi corsi (molte lauree usano STEM).
              </small>
            </label>

            <button
              type="button"
              className="button button--primary button--wide"
              onClick={() => void login()}
              disabled={busy}
            >
              <ShieldIcon />
              Accedi con Moodle
            </button>
          </div>

          <div className="storage-note">
            <ShieldIcon />
            <span>
              Archiviazione: <strong>{secureStorageLabel(auth?.secureStorage ?? 'unavailable')}</strong>
              {secure && '. L’accesso resta salvato nel portachiavi: non dovrai rifare il login a ogni avvio.'}
              {auth?.secureStorage === 'basic-text' &&
                '. L’accesso resta salvato su questo dispositivo: non dovrai rifare il login a ogni avvio.'}
              {!persistent &&
                '. Il token non verrà scritto su disco: dovrai accedere a ogni avvio.'}
            </span>
          </div>
        </div>
      </section>

      {busy && (
        <div className="busy-overlay" role="status" aria-live="polite">
          <div className="busy-card">
            <span className="spinner" />
            <h2>Accesso in corso</h2>
            <p>
              Completa il login nella finestra UniPD. Se richiesto, conferma il
              secondo fattore di autenticazione.
            </p>
            <small>La finestra si chiuderà automaticamente al termine.</small>
          </div>
        </div>
      )}
    </div>
  )
}
