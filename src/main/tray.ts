import { app, Menu, nativeImage, Tray } from 'electron'
import { APP_NAME } from '../shared/types'
import type { AuthService } from './auth/auth-service'
import { logger } from './logger'
import { getResourcePath } from './resources'
import type { SyncService } from './sync/sync-service'

export interface AppTray {
  refresh: () => void
  destroy: () => void
}

interface TrayDependencies {
  auth: AuthService
  sync: SyncService
  showWindow: () => void
  openVault: () => Promise<void>
}

export function createAppTray({
  auth,
  sync,
  showWindow,
  openVault
}: TrayDependencies): AppTray {
  const image = nativeImage.createFromPath(getResourcePath('tray.png'))
  if (image.isEmpty()) {
    logger.warn('Icona tray non trovata.')
  }
  const tray = new Tray(image.resize({ width: 20, height: 20 }))
  tray.setToolTip(APP_NAME)
  tray.on('click', showWindow)
  tray.on('double-click', showWindow)

  const refresh = (): void => {
    const status = auth.getStatus()
    const progress = sync.getProgress()
    const connected = status.state === 'authenticated'
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Apri UnipdDispense',
          click: showWindow
        },
        {
          label: connected
            ? `Connesso come ${status.user?.fullname || status.user?.username || 'studente'}`
            : 'Non connesso a Moodle',
          enabled: false
        },
        { type: 'separator' },
        {
          label: progress.running ? 'Sincronizzazione in corso…' : 'Sincronizza ora',
          enabled: connected && !progress.running,
          click: () => {
            showWindow()
            void sync.start({ reason: 'manual' }).catch((error) => {
              logger.warn('Sync manuale dal tray non riuscita:', String(error))
            })
          }
        },
        {
          label: 'Apri vault',
          click: () => {
            void openVault().catch((error) => {
              logger.warn('Apertura vault non riuscita:', String(error))
            })
          }
        },
        { type: 'separator' },
        {
          label: 'Esci',
          click: () => {
            app.quit()
          }
        }
      ])
    )
  }

  refresh()
  return {
    refresh,
    destroy: () => tray.destroy()
  }
}
