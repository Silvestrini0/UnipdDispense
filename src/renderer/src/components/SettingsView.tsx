import type { JSX } from 'react'
import {
  MOODLE_BASE_URL,
  MOODLE_PLATFORMS,
  moodlePlatformLabel
} from '../../../shared/types'
import { useAppStore } from '../store'
import { secureStorageLabel } from '../utils'
import {
  AlertIcon,
  ExternalIcon,
  FolderIcon,
  LogoutIcon,
  PowerIcon,
  ServerIcon,
  ShieldIcon,
  UserIcon
} from './Icons'
import { Switch } from './Switch'

export function SettingsView(): JSX.Element {
  const info = useAppStore((state) => state.info)
  const settings = useAppStore((state) => state.settings)
  const auth = useAppStore((state) => state.auth)
  const saving = useAppStore((state) => state.settingsSaving)
  const saveSettings = useAppStore((state) => state.saveSettings)
  const chooseVault = useAppStore((state) => state.chooseVault)
  const openVault = useAppStore((state) => state.openVault)
  const logout = useAppStore((state) => state.logout)
  const quit = useAppStore((state) => state.quit)

  if (!settings) {
    return <div className="view" />
  }

  const secure = auth?.secureStorage === 'secure'
  const persistent = secure || auth?.secureStorage === 'basic-text'

  return (
    <div className="view settings-view">
      <section className="card account-panel">
        <span className="avatar avatar--large">
          {auth?.user?.fullname
            ?.split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join('') || (
            <UserIcon />
          )}
        </span>
        <div className="account-panel__copy">
          <span className="eyebrow">Account Moodle</span>
          <h2>{auth?.user?.fullname || auth?.user?.username || 'Studente UniPD'}</h2>
          <p>
            {auth?.user?.username} · {auth?.user?.siteName || 'Moodle UniPD'}
          </p>
        </div>
        <span className="status-pill status-pill--ok">
          <span className="status-pill__dot" />
          Connesso
        </span>
        <button type="button" className="button button--secondary" onClick={() => void logout()}>
          <LogoutIcon />
          Disconnetti
        </button>
      </section>

      <div className="settings-grid">
        <section className="card settings-card">
          <div className="card__header">
            <div>
              <span className="eyebrow">Archivio</span>
              <h2>Vault Obsidian</h2>
            </div>
            <span className="icon-badge">
              <FolderIcon />
            </span>
          </div>
          <p className="muted">
            L’app crea una cartella per ogni corso, gli indici e la cartella
            <code> Schede file</code>.
          </p>
          <div className="path-box" title={settings.vaultPath}>
            {settings.vaultPath}
          </div>
          <div className="button-row">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void chooseVault()}
              disabled={saving}
            >
              Scegli cartella
            </button>
            <button type="button" className="button button--ghost" onClick={() => void openVault()}>
              <ExternalIcon />
              Apri
            </button>
          </div>
        </section>

        <section className="card settings-card">
          <div className="card__header">
            <div>
              <span className="eyebrow">Automazione</span>
              <h2>Sincronizzazione</h2>
            </div>
            <span className="icon-badge">
              <ServerIcon />
            </span>
          </div>
          <div className="setting-row">
            <div>
              <strong>Controllo automatico</strong>
              <span>Verifica Moodle e scarica solo le novità.</span>
            </div>
            <Switch
              checked={settings.autoSync}
              onChange={(checked) => void saveSettings({ autoSync: checked })}
              disabled={saving}
              label="Controllo automatico"
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Intervallo</strong>
              <span>Frequenza dei controlli mentre l’app è aperta.</span>
            </div>
            <select
              className="select"
              value={settings.syncIntervalMinutes}
              onChange={(event) =>
                void saveSettings({ syncIntervalMinutes: Number(event.target.value) })
              }
              disabled={saving || !settings.autoSync}
              aria-label="Intervallo di sincronizzazione"
            >
              <option value={15}>15 minuti</option>
              <option value={30}>30 minuti</option>
              <option value={60}>1 ora</option>
              <option value={120}>2 ore</option>
            </select>
          </div>
          <p className="setting-note">
            La prima verifica parte pochi secondi dopo l’avvio, poi rispetta
            l’intervallo scelto.
          </p>
        </section>

        <section className="card settings-card">
          <div className="card__header">
            <div>
              <span className="eyebrow">Sicurezza</span>
              <h2>Accesso e credenziali</h2>
            </div>
            <span className="icon-badge">
              <ShieldIcon />
            </span>
          </div>
          <div className="setting-row">
            <div>
              <strong>Piattaforma Moodle</strong>
              <span>Cambiarla richiede un nuovo accesso.</span>
            </div>
            <select
              className="select"
              value={settings.moodleBaseUrl}
              onChange={(event) =>
                void saveSettings({ moodleBaseUrl: event.target.value })
              }
              disabled={saving}
              aria-label="Piattaforma Moodle"
            >
              {!MOODLE_PLATFORMS.some(
                (platform) => platform.url === (settings.moodleBaseUrl || MOODLE_BASE_URL)
              ) && (
                <option value={settings.moodleBaseUrl}>
                  {moodlePlatformLabel(settings.moodleBaseUrl)}
                </option>
              )}
              {MOODLE_PLATFORMS.map((platform) => (
                <option key={platform.id} value={platform.url}>
                  {platform.label}
                </option>
              ))}
            </select>
          </div>
          <div className={`security-box ${persistent ? 'security-box--ok' : 'security-box--warning'}`}>
            {secure ? <ShieldIcon /> : <AlertIcon />}
            <div>
              <strong>{secureStorageLabel(auth?.secureStorage ?? 'unavailable')}</strong>
              <span>
                {secure &&
                  'Token e credenziali sono cifrati dal portachiavi del sistema operativo.'}
                {auth?.secureStorage === 'basic-text' &&
                  'Il portachiavi di sistema non è attivo: il token di accesso è salvato in locale (cifratura debole) per non richiedere il login a ogni avvio.'}
                {auth?.secureStorage === 'unavailable' &&
                  'Senza archiviazione sicura il token non viene salvato: l’app chiederà il login a ogni avvio.'}
              </span>
            </div>
          </div>
        </section>

        <section className="card settings-card">
          <div className="card__header">
            <div>
              <span className="eyebrow">Sistema</span>
              <h2>Applicazione</h2>
            </div>
            <span className="icon-badge">
              <PowerIcon />
            </span>
          </div>
          <div className="setting-row">
            <div>
              <strong>Avvia con il sistema</strong>
              <span>Apri l’app all’accesso, senza mostrare la finestra.</span>
            </div>
            <Switch
              checked={settings.launchAtLogin}
              onChange={(checked) => void saveSettings({ launchAtLogin: checked })}
              disabled={saving}
              label="Avvia con il sistema"
            />
          </div>
          <dl className="info-list">
            <div>
              <dt>Versione</dt>
              <dd>{info?.version ?? '—'}</dd>
            </div>
            <div>
              <dt>Piattaforma</dt>
              <dd>{info?.platform ?? '—'}</dd>
            </div>
            <div>
              <dt>Dati applicazione</dt>
              <dd className="info-list__path" title={info?.userDataPath}>
                {info?.userDataPath ?? '—'}
              </dd>
            </div>
          </dl>
          <button type="button" className="button button--ghost button--danger" onClick={() => void quit()}>
            <PowerIcon />
            Esci da UniPD Dispense
          </button>
        </section>
      </div>
    </div>
  )
}
