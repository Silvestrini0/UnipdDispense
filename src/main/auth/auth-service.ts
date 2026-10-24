import { BrowserWindow, net, session, type Session } from 'electron'
import type { AuthStatus, AuthUser, SecureStorageState } from '../../shared/types'
import type { MoodleSiteInfo } from '../moodle/types'
import { MoodleApi, MoodleApiError } from '../moodle/api'
import { errorMessage, logger, sanitizeUrl } from '../logger'
import { SecretsStore } from '../secrets-store'
import {
  buildLaunchUrl,
  createPassport,
  createSiteId,
  parseLaunchRedirect,
  type LaunchToken
} from './token'

export class AuthRequiredError extends Error {
  constructor(message = 'Accedi a Moodle per continuare.') {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

type StatusListener = (status: AuthStatus) => void

export class AuthService {
  private readonly authSession: Session
  private readonly listeners = new Set<StatusListener>()
  private loginPromise: Promise<AuthStatus> | null = null
  private currentRecord: { token: string; privateToken: string | null; siteId: string } | null =
    null
  private siteInfo: MoodleSiteInfo | null = null
  private status: AuthStatus

  constructor(
    private baseUrl: string,
    partition: string,
    private readonly secrets: SecretsStore
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.authSession = session.fromPartition(partition)
    this.status = this.baseStatus('unknown')
  }

  setBaseUrl(baseUrl: string): void {
    const normalized = normalizeBaseUrl(baseUrl)
    if (normalized === this.baseUrl) {
      return
    }
    this.baseUrl = normalized
    this.currentRecord = null
    this.siteInfo = null
    void this.secrets.clearToken().catch((error) => {
      logger.warn('Impossibile rimuovere il token precedente:', errorMessage(error))
    })
    this.setStatus({
      ...this.baseStatus('signed-out'),
      error: 'Piattaforma Moodle cambiata. Effettua di nuovo l’accesso.'
    })
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  getStatus(): AuthStatus {
    return structuredClone(this.status)
  }

  onStatusChanged(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async restore(): Promise<AuthStatus> {
    await this.secrets.load()
    const stored = this.secrets.getToken()
    if (stored) {
      const result = await this.tryStoredToken(stored)
      if (result) {
        return result
      }
    }
    const silent = await this.trySilentSession()
    if (silent) {
      return silent
    }
    this.currentRecord = null
    this.siteInfo = null
    return this.setStatus({
      ...this.baseStatus('signed-out'),
      error: stored ? 'La sessione Moodle è scaduta.' : undefined
    })
  }

  async login(): Promise<AuthStatus> {
    if (this.loginPromise) {
      return this.loginPromise
    }
    this.loginPromise = this.runLogin().finally(() => {
      this.loginPromise = null
    })
    return this.loginPromise
  }

  async logout(): Promise<AuthStatus> {
    await this.secrets.clearToken()
    this.currentRecord = null
    this.siteInfo = null
    try {
      await this.authSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
      })
      await this.authSession.clearCache()
    } catch (error) {
      logger.warn('Impossibile pulire la sessione Moodle:', errorMessage(error))
    }
    return this.setStatus(this.baseStatus('signed-out'))
  }

  async getApi(): Promise<MoodleApi> {
    if (!this.currentRecord) {
      await this.restore()
    }
    if (!this.currentRecord) {
      throw new AuthRequiredError()
    }
    return new MoodleApi(this.baseUrl, this.currentRecord.token)
  }

  async withApi<T>(operation: (api: MoodleApi) => Promise<T>): Promise<T> {
    let api: MoodleApi
    try {
      api = await this.getApi()
    } catch (error) {
      if (error instanceof MoodleApiError) {
        await this.invalidateSession(error.message)
      }
      throw error
    }
    try {
      return await operation(api)
    } catch (error) {
      if (error instanceof MoodleApiError && error.code === 'invalidtoken') {
        await this.invalidateSession('Il token Moodle non è più valido.')
        throw new AuthRequiredError()
      }
      throw error
    }
  }

  private async runLogin(): Promise<AuthStatus> {
    if (this.currentRecord && this.status.state === 'authenticated') {
      return this.getStatus()
    }
    this.setStatus({ ...this.baseStatus('signing-in') })
    const stored = await this.tryStoredToken(this.secrets.getToken())
    if (stored) {
      return stored
    }
    const silent = await this.trySilentSession()
    if (silent) {
      return silent
    }
    try {
      await this.openLoginWindow()
    } catch (error) {
      return this.setStatus({
        ...this.baseStatus('error'),
        error: errorMessage(error)
      })
    }
    return this.getStatus()
  }

  private async tryStoredToken(
    stored: ReturnType<SecretsStore['getToken']>
  ): Promise<AuthStatus | null> {
    if (!stored) {
      return null
    }
    if (stored.baseUrl && normalizeBaseUrl(stored.baseUrl) !== this.baseUrl) {
      logger.info('Token Moodle ignorato: appartiene a un’altra piattaforma.')
      return null
    }
    try {
      const api = new MoodleApi(this.baseUrl, stored.token)
      const info = await api.getSiteInfo()
      await this.acceptAuthenticated(stored, info)
      return this.getStatus()
    } catch (error) {
      if (error instanceof MoodleApiError && error.code === 'invalidtoken') {
        await this.secrets.clearToken()
        return null
      }
      if (stored.user) {
        this.currentRecord = {
          token: stored.token,
          privateToken: stored.privateToken,
          siteId: stored.siteId
        }
        this.siteInfo = null
        return this.setStatus({
          ...this.baseStatus('authenticated'),
          user: stored.user,
          error:
            'Moodle non è raggiungibile in questo momento. I dati salvati restano disponibili.'
        })
      }
      logger.warn('Token salvato non verificabile:', errorMessage(error))
      return null
    }
  }

  private async trySilentSession(): Promise<AuthStatus | null> {
    if (!(await this.hasMoodleCookies())) {
      return null
    }
    try {
      const token = await this.captureToken(false)
      if (!token) {
        return null
      }
      const api = new MoodleApi(this.baseUrl, token.token)
      const info = await api.getSiteInfo()
      await this.acceptAuthenticated(token, info)
      return this.getStatus()
    } catch (error) {
      if (!(error instanceof MoodleApiError && error.code === 'invalidtoken')) {
        logger.debug('Ripristino silenzioso non riuscito:', errorMessage(error))
      }
      return null
    }
  }

  private async acceptAuthenticated(
    token: LaunchToken,
    info: MoodleSiteInfo
  ): Promise<void> {
    const user = this.toUser(info)
    await this.secrets.setToken({
      token: token.token,
      privateToken: token.privateToken,
      siteId: token.siteId,
      baseUrl: this.baseUrl,
      user
    })
    this.currentRecord = {
      token: token.token,
      privateToken: token.privateToken,
      siteId: token.siteId
    }
    this.siteInfo = info
    this.setStatus({
      ...this.baseStatus('authenticated'),
      user
    })
  }

  private async openLoginWindow(): Promise<void> {
    const passport = createPassport()
    const expectedSiteId = createSiteId(this.baseUrl, passport)
    const launchUrl = buildLaunchUrl(this.baseUrl, passport, 'moodle-vault')
    if (await this.hasMoodleCookies()) {
      try {
        const cookies = await this.authSession.cookies.get({ url: this.baseUrl })
        for (const cookie of cookies) {
          await this.authSession.cookies.remove(this.baseUrl, cookie.name)
        }
      } catch (error) {
        logger.warn('Pulizia sessione precedente non riuscita:', errorMessage(error))
      }
    }
    const launchTarget = new URL(launchUrl)
    const loginUrl = new URL(`${this.baseUrl.replace(/\/+$/, '')}/auth/shibboleth/index.php`)
    loginUrl.searchParams.set('target', `${launchTarget.pathname}${launchTarget.search}`)
    logger.info('Apro la finestra di accesso Moodle.')
    const window = new BrowserWindow({
      width: 1000,
      height: 760,
      minWidth: 760,
      minHeight: 560,
      show: false,
      title: 'Accesso UniPD',
      autoHideMenuBar: true,
      backgroundColor: '#f8fafc',
      webPreferences: {
        session: this.authSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        spellcheck: false
      }
    })
    window.setMenuBarVisibility(false)
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url)
        if (target.protocol === 'https:' && (isUnipdHost(target.hostname))) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              webPreferences: {
                session: this.authSession,
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true
              }
            }
          }
        }
      } catch {
        return { action: 'deny' }
      }
      return { action: 'deny' }
    })

    const showTimer = setTimeout(() => {
      if (!window.isDestroyed() && !window.isVisible()) {
        window.show()
      }
    }, 1400)

    let settled = false
    let checking = false
    let pollTimer: NodeJS.Timeout | null = null
    let probes = 0

    const cleanup = (): void => {
      settled = true
      clearTimeout(showTimer)
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }

    const closeWindow = (): void => {
      if (!window.isDestroyed()) {
        window.close()
      }
    }

    await new Promise<void>((resolve, reject) => {
      const succeed = async (knownToken?: LaunchToken): Promise<boolean> => {
        checking = true
        try {
          const token = knownToken ?? (await this.captureToken(true))
          if (!token) {
            checking = false
            return false
          }
          const api = new MoodleApi(this.baseUrl, token.token)
          const info = await api.getSiteInfo()
          await this.acceptAuthenticated(token, info)
          cleanup()
          closeWindow()
          resolve()
          return true
        } catch (error) {
          checking = false
          logger.warn('Recupero token dopo il login non riuscito:', errorMessage(error))
          return false
        }
      }

      const handleScheme = (url: string): boolean => {
        const token = parseLaunchRedirect(url, expectedSiteId)
        if (!token) {
          return false
        }
        logger.info('Token Moodle acquisito dalla finestra di accesso.')
        void succeed(token)
        return true
      }

      const guardScheme = (event: Electron.Event, url: string): void => {
        if (url.startsWith('moodle-vault://')) {
          event.preventDefault()
          handleScheme(url)
        }
      }

      const readLaunchHref = async (): Promise<string | null> => {
        try {
          const href = await window.webContents.executeJavaScript(
            `(() => { const link = document.getElementById('launchapp'); return link ? link.getAttribute('href') : null })()`,
            true
          )
          return typeof href === 'string' ? href : null
        } catch {
          return null
        }
      }

      const isMoodlePage = (): URL | null => {
        const currentUrl = window.webContents.getURL()
        if (!currentUrl) {
          return null
        }
        try {
          const parsed = new URL(currentUrl)
          const base = new URL(this.baseUrl)
          if (parsed.origin !== base.origin) {
            return null
          }
          if (parsed.pathname.includes('/login/') || parsed.pathname.includes('/auth/')) {
            return null
          }
          return parsed
        } catch {
          return null
        }
      }

      const check = async (): Promise<void> => {
        if (settled || checking || window.isDestroyed()) {
          return
        }
        if (!isMoodlePage()) {
          return
        }
        try {
          const launchHref = await readLaunchHref()
          if (launchHref?.startsWith('moodle-vault://')) {
            await succeed(parseLaunchRedirect(launchHref, expectedSiteId) ?? undefined)
            return
          }
          const loggedIn = await window.webContents.executeJavaScript(
            `Boolean(document.body) && Boolean(document.querySelector('[data-region="user-menu"], .usermenu, #usermenu, .logininfo, a[href*="/user/profile.php"]'))`,
            true
          )
          if (loggedIn) {
            await succeed()
          }
        } catch {
          return
        }
      }

      const probe = async (): Promise<void> => {
        if (settled || checking || window.isDestroyed()) {
          return
        }
        if (!isMoodlePage()) {
          return
        }
        checking = true
        try {
          const token = await this.captureToken(false)
          checking = false
          if (token) {
            await succeed(token)
          }
        } catch {
          checking = false
        }
      }

      window.webContents.on('did-finish-load', () => {
        void window.webContents
          .executeJavaScript('document.title', true)
          .then((title) =>
            logger.info('Login: pagina', sanitizeUrl(window.webContents.getURL()), String(title))
          )
          .catch(() => undefined)
        void check()
      })
      window.webContents.on('did-navigate', (_event, url) => {
        logger.info('Login: navigazione verso', sanitizeUrl(url))
        void check()
      })
      window.webContents.on('will-redirect', (event, url) => guardScheme(event, url))
      window.webContents.on('will-navigate', (event, url) => guardScheme(event, url))
      window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        if (url.startsWith('moodle-vault://')) {
          handleScheme(url)
          return
        }
        if (isMainFrame && code !== -3) {
          logger.warn(`Login: caricamento fallito ${sanitizeUrl(url)} (${description})`)
        }
      })
      window.on('closed', () => {
        cleanup()
        if (!this.status || this.status.state !== 'authenticated') {
          this.setStatus({
            ...this.baseStatus('signed-out'),
            error: 'Accesso annullato.'
          })
        }
        resolve()
      })

      pollTimer = setInterval(() => {
        probes += 1
        if (probes % 3 === 0) {
          void probe()
        }
        void check()
      }, 1000)

      window.loadURL(loginUrl.toString()).catch((error) => {
        cleanup()
        reject(error)
      })
    })
  }

  private async captureToken(allowWindow: boolean): Promise<LaunchToken | null> {
    const passport = createPassport()
    const expectedSiteId = createSiteId(this.baseUrl, passport)
    const launchUrl = buildLaunchUrl(this.baseUrl, passport, 'moodle-vault')
    const redirect = await this.requestLaunchRedirect(launchUrl)
    if (redirect) {
      const parsed = parseLaunchRedirect(redirect, expectedSiteId)
      if (parsed) {
        logger.info('Token Moodle acquisito tramite sessione esistente.')
        return parsed
      }
      logger.debug('Redirect non riconosciuto dal launch mobile:', sanitizeUrl(redirect))
    }
    try {
      const response = await this.authSession.fetch(launchUrl, {
        redirect: 'manual',
        credentials: 'include',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': this.authSession.getUserAgent()
        },
        signal: AbortSignal.timeout(20_000)
      })
      const location = response.headers.get('location')
      if (location) {
        const parsed = parseLaunchRedirect(location, expectedSiteId)
        if (parsed) {
          return parsed
        }
      }
      const text = await response.text()
      const schemeUrl = text.match(/moodle-vault:\/\/token=[^"'\s<]+/)
      if (schemeUrl?.[0]) {
        const parsed = parseLaunchRedirect(schemeUrl[0], expectedSiteId)
        if (parsed) {
          return parsed
        }
      }
    } catch (error) {
      logger.debug('Recupero token via sessione non riuscito:', errorMessage(error))
    }
    if (!allowWindow) {
      return null
    }
    return this.captureTokenFromWindow(launchUrl, expectedSiteId)
  }

  private requestLaunchRedirect(launchUrl: string): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false
      let timer: NodeJS.Timeout | null = null
      const finish = (value: string | null): void => {
        if (settled) {
          return
        }
        settled = true
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        resolve(value)
      }
      try {
        const request = net.request({
          method: 'GET',
          url: launchUrl,
          session: this.authSession,
          redirect: 'manual',
          useSessionCookies: true,
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'User-Agent': this.authSession.getUserAgent()
          }
        })
        timer = setTimeout(() => {
          try {
            request.abort()
          } catch {
            // La richiesta potrebbe essere già terminata.
          }
          finish(null)
        }, 15_000)
        request.on('redirect', (_statusCode: number, _method: string, redirectUrl: string) => {
          finish(redirectUrl)
          try {
            request.abort()
          } catch {
            // La richiesta potrebbe essere già terminata.
          }
        })
        request.on('response', (response: Electron.IncomingMessage) => {
          const location = response.headers.location
          finish(Array.isArray(location) ? (location[0] ?? null) : (location ?? null))
          response.on('data', () => undefined)
          response.on('end', () => undefined)
        })
        request.on('error', () => finish(null))
        request.on('abort', () => finish(null))
        request.end()
      } catch {
        finish(null)
      }
    })
  }

  private async captureTokenFromWindow(
    launchUrl: string,
    expectedSiteId: string
  ): Promise<LaunchToken | null> {
    return new Promise((resolve) => {
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          session: this.authSession,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      })
      let resolved = false
      const finish = (token: LaunchToken | null): void => {
        if (resolved) {
          return
        }
        resolved = true
        clearTimeout(timer)
        if (!window.isDestroyed()) {
          window.destroy()
        }
        resolve(token)
      }
      const inspect = (url: string): void => {
        if (url.startsWith('moodle-vault://')) {
          finish(parseLaunchRedirect(url, expectedSiteId))
        }
      }
      const timer = setTimeout(() => finish(null), 15_000)
      window.webContents.on('will-redirect', (event, url) => {
        if (url.startsWith('moodle-vault://')) {
          event.preventDefault()
          inspect(url)
        }
      })
      window.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith('moodle-vault://')) {
          event.preventDefault()
          inspect(url)
        }
      })
      window.webContents.on('did-fail-load', (_event, _code, _description, url) => {
        inspect(url)
      })
      window.webContents.on('did-navigate', (_event, url) => inspect(url))
      window.loadURL(launchUrl).catch(() => finish(null))
    })
  }

  private async hasMoodleCookies(): Promise<boolean> {
    try {
      const cookies = await this.authSession.cookies.get({ url: this.baseUrl })
      return cookies.some((cookie) => cookie.name.toLowerCase().includes('moodlesession'))
    } catch {
      return false
    }
  }

  private async invalidateSession(message: string): Promise<void> {
    await this.secrets.clearToken()
    this.currentRecord = null
    this.siteInfo = null
    this.setStatus({
      ...this.baseStatus('signed-out'),
      error: message
    })
  }

  private toUser(info: MoodleSiteInfo): AuthUser {
    return {
      id: info.userid,
      username: info.username,
      fullname: info.fullname || `${info.firstname} ${info.lastname}`.trim(),
      siteName: info.sitename,
      siteUrl: info.siteurl
    }
  }

  private baseStatus(state: AuthStatus['state']): AuthStatus {
    return {
      state,
      user: this.siteInfo ? this.toUser(this.siteInfo) : null,
      secureStorage: this.secrets.secureStorage as SecureStorageState
    }
  }

  private setStatus(next: AuthStatus): AuthStatus {
    this.status = next
    const snapshot = structuredClone(next)
    for (const listener of this.listeners) {
      listener(snapshot)
    }
    return snapshot
  }
}

function isUnipdHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'unipd.it' || host.endsWith('.unipd.it')
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}
