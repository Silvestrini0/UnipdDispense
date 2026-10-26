import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { logger } from './logger'

const HIDDEN_ARGUMENT = '--hidden'
const AUTOSTART_FILE = 'unipddispense.desktop'

export async function applyLaunchAtLogin(enabled: boolean): Promise<void> {
  if (process.platform === 'linux') {
    await updateLinuxAutostart(enabled)
    return
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      ...(process.platform === 'win32' ? { args: [HIDDEN_ARGUMENT] } : {})
    })
  } catch (error) {
    logger.warn('Impossibile configurare l’avvio automatico:', String(error))
  }
}

async function updateLinuxAutostart(enabled: boolean): Promise<void> {
  const configHome = process.env.XDG_CONFIG_HOME || join(app.getPath('home'), '.config')
  const autostartDirectory = join(resolve(configHome), 'autostart')
  const autostartPath = join(autostartDirectory, AUTOSTART_FILE)

  try {
    if (!enabled) {
      await rm(autostartPath, { force: true })
      return
    }

    await mkdir(autostartDirectory, { recursive: true })
    const executable = process.env.APPIMAGE || app.getPath('exe')
    const desktopEntry = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=UnipdDispense',
      `Exec=${escapeDesktopArgument(executable)} ${HIDDEN_ARGUMENT}`,
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      ''
    ].join('\n')

    await writeFile(autostartPath, desktopEntry, { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    logger.warn('Impossibile configurare l’avvio automatico:', String(error))
  }
}

function escapeDesktopArgument(value: string): string {
  const escaped = value
    .replace(/([\\`"$])/g, '\\$1')
    .replace(/%/g, '%%')
  return `"${escaped}"`
}
