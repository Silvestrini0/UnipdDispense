import { join } from 'node:path'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { APP_NAME } from '../shared/types'
import { logger } from './logger'
import { getResourcePath } from './resources'

let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function createMainWindow(options: { startHidden?: boolean } = {}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: '#f7f8fb',
    icon: getResourcePath('icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false
    }
  })

  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  } else {
    window.setMenuBarVisibility(false)
  }

  window.on('ready-to-show', () => {
    if (!options.startHidden && !process.argv.includes('--hidden')) {
      window.show()
    }
  })

  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:') {
        void shell.openExternal(target.toString())
      }
    } catch {
      return { action: 'deny' }
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const allowed = rendererUrlAllowed(url, window.webContents.getURL())
    if (!allowed) {
      event.preventDefault()
      try {
        const target = new URL(url)
        if (target.protocol === 'https:') {
          void shell.openExternal(target.toString())
        }
      } catch {
        logger.debug('Navigazione esterna bloccata.')
      }
    }
  })

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('Renderer terminato:', details.reason)
  })

  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) {
    void window.loadURL(developmentUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function rendererUrlAllowed(target: string, current: string): boolean {
  try {
    const targetUrl = new URL(target)
    const currentUrl = new URL(current)
    if (targetUrl.protocol === 'file:') {
      return targetUrl.pathname === currentUrl.pathname
    }
    return (
      targetUrl.origin === currentUrl.origin &&
      (currentUrl.hostname === 'localhost' || currentUrl.hostname === '127.0.0.1')
    )
  } catch {
    return false
  }
}
