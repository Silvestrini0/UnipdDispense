import { createHash, randomBytes } from 'node:crypto'

export interface LaunchToken {
  token: string
  privateToken: string | null
  siteId: string
}

export function createPassport(): string {
  return randomBytes(16).toString('hex')
}

export function createSiteId(baseUrl: string, passport: string): string {
  return createHash('md5')
    .update(`${baseUrl.replace(/\/+$/, '')}${passport}`)
    .digest('hex')
}

export function buildLaunchUrl(baseUrl: string, passport: string, scheme: string): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/admin/tool/mobile/launch.php`)
  url.searchParams.set('service', 'moodle_mobile_app')
  url.searchParams.set('passport', passport)
  url.searchParams.set('urlscheme', scheme)
  return url.toString()
}

function decodePayload(encoded: string): string | null {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const variants = [normalized]
  if (normalized.endsWith('/')) {
    variants.push(normalized.slice(0, -1))
  }
  for (const variant of variants) {
    try {
      const decoded = Buffer.from(variant, 'base64').toString('utf8')
      if (decoded.includes(':::')) {
        return decoded
      }
    } catch {
      continue
    }
  }
  return null
}

export function parseLaunchRedirect(
  rawRedirect: string,
  expectedSiteId?: string
): LaunchToken | null {
  const markerIndex = rawRedirect.indexOf('token=')
  if (markerIndex < 0) {
    return null
  }
  let encoded = rawRedirect.slice(markerIndex + 'token='.length)
  const separatorIndex = encoded.search(/[&#]/)
  if (separatorIndex >= 0) {
    encoded = encoded.slice(0, separatorIndex)
  }
  if (!encoded) {
    return null
  }
  try {
    encoded = decodeURIComponent(encoded)
  } catch {
    return null
  }
  const decoded = decodePayload(encoded.trim())
  if (!decoded) {
    return null
  }
  const [siteId, token, privateToken] = decoded.split(':::')
  if (!siteId || !token) {
    return null
  }
  if (expectedSiteId && siteId !== expectedSiteId) {
    return null
  }
  return {
    token,
    privateToken: privateToken || null,
    siteId
  }
}
