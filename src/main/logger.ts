import log from 'electron-log/main'

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn'
log.transports.file.maxSize = 5 * 1024 * 1024

log.errorHandler.startCatching({
  showDialog: false
})

export const logger = log.scope('app')

export function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    for (const key of ['token', 'wstoken', 'password', 'passport']) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, '***')
      }
    }
    return url.toString()
  } catch {
    return raw.replace(/(token|wstoken|password|passport)=[^&\s]+/gi, '$1=***')
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
