import type { JSX } from 'react'
import { useAppStore } from '../store'
import { AlertIcon, DownloadIcon } from './Icons'

interface UpdateBannerProps {
  floating?: boolean
}

export function UpdateBanner({ floating = false }: UpdateBannerProps): JSX.Element | null {
  const update = useAppStore((state) => state.update)
  const platform = useAppStore((state) => state.info?.platform)
  const checkForUpdate = useAppStore((state) => state.checkForUpdate)
  const downloadUpdate = useAppStore((state) => state.downloadUpdate)
  const installUpdate = useAppStore((state) => state.installUpdate)
  const openSecuritySettings = useAppStore((state) => state.openUpdateSecuritySettings)

  if (!['available', 'downloading', 'downloaded', 'error'].includes(update.state)) {
    return null
  }

  const version = update.availableVersion
  const error = update.state === 'error'
  const title = error
    ? 'Aggiornamento non riuscito'
    : update.state === 'downloaded'
      ? `La versione ${version} è pronta`
      : update.state === 'downloading'
        ? `Scaricamento della versione ${version} in corso`
        : `È disponibile la versione ${version}`

  return (
    <section
      className={`update-banner${floating ? ' update-banner--floating' : ''}${error ? ' update-banner--error' : ''}`}
      role={error ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className="update-banner__icon">
        {error ? <AlertIcon /> : <DownloadIcon />}
      </span>
      <div className="update-banner__copy">
        <strong>{title}</strong>
        <span>
          {error
            ? update.error
            : update.state === 'downloaded'
              ? platform === 'darwin'
                ? 'Puoi aprire Privacy e Sicurezza prima di installare. Dopo il riavvio, se macOS blocca l’app, premi Apri comunque e conferma Apri.'
                : 'Usa il pulsante rosso in alto per riavviare e installare l’aggiornamento.'
              : update.state === 'downloading'
                ? `${Math.round(update.percent)}% completato. Puoi continuare a usare l’app.`
                : 'È pronta per essere scaricata e installata.'}
        </span>
        {update.state === 'downloading' && (
          <div
            className="update-progress"
            role="progressbar"
            aria-label="Progresso del download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(update.percent)}
          >
            <span style={{ width: `${Math.max(0, Math.min(100, update.percent))}%` }} />
          </div>
        )}
      </div>
      {floating && update.state === 'available' && (
        <button
          type="button"
          className="button button--update"
          onClick={() => void downloadUpdate()}
        >
          <DownloadIcon />
          Aggiorna alla versione {version}
        </button>
      )}
      {update.state === 'downloaded' && (floating || platform === 'darwin') && (
        <div className="update-banner__actions">
          {platform === 'darwin' && (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void openSecuritySettings()}
            >
              Apri Privacy e Sicurezza
            </button>
          )}
          {floating && (
            <button
              type="button"
              className="button button--update"
              onClick={() => void installUpdate()}
            >
              <DownloadIcon />
              Riavvia e installa
            </button>
          )}
        </div>
      )}
      {floating && error && (
        <button
          type="button"
          className="button button--update"
          onClick={() => void (version ? downloadUpdate() : checkForUpdate())}
        >
          <DownloadIcon />
          Riprova
        </button>
      )}
    </section>
  )
}
