import type { JSX } from 'react'
import { useAppStore } from '../store'
import { AlertIcon, DownloadIcon } from './Icons'

interface UpdateBannerProps {
  floating?: boolean
}

export function UpdateBanner({ floating = false }: UpdateBannerProps): JSX.Element | null {
  const update = useAppStore((state) => state.update)
  const sync = useAppStore((state) => state.sync)
  const platform = useAppStore((state) => state.info?.platform)
  const installUpdate = useAppStore((state) => state.installUpdate)
  const openSecuritySettings = useAppStore((state) => state.openUpdateSecuritySettings)

  if (
    !['available', 'downloading', 'canceling', 'downloaded', 'installing', 'error'].includes(
      update.state
    )
  ) {
    return null
  }

  const version = update.availableVersion
  const error = update.state === 'error'
  const title = error
    ? 'Aggiornamento non riuscito'
    : update.state === 'downloaded'
      ? `La versione ${version} è pronta`
      : update.state === 'installing'
        ? 'Preparazione dell’aggiornamento'
        : update.state === 'canceling'
          ? 'Interruzione del download in corso'
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
              ? sync.running
                ? 'La sincronizzazione è in corso. Potrai installare l’aggiornamento al termine.'
                : platform === 'darwin'
                  ? 'Puoi aprire Privacy e Sicurezza prima di installare. Dopo il riavvio, se macOS blocca l’app, premi Apri comunque e conferma Apri.'
                  : 'Riavvia l’app per completare l’installazione.'
              : update.state === 'installing'
                ? 'Attendi il completamento della preparazione. La sincronizzazione è temporaneamente sospesa.'
                : update.state === 'canceling'
                  ? 'Sto arrestando il download in modo sicuro.'
              : update.state === 'downloading'
                ? `${Math.round(update.percent)}% completato. Puoi continuare a usare l’app.`
                : 'Premi il pulsante circolare rosso per scaricarla.'}
        </span>
        {['downloading', 'canceling'].includes(update.state) && (
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
              className="button button--primary"
              onClick={() => void installUpdate()}
              disabled={sync.running}
              title={sync.running ? 'Attendi il completamento della sincronizzazione' : undefined}
            >
              <DownloadIcon />
              Riavvia e installa
            </button>
          )}
        </div>
      )}
    </section>
  )
}
