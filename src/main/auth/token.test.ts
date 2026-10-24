import { describe, expect, it } from 'vitest'
import {
  buildLaunchUrl,
  createSiteId,
  parseLaunchRedirect
} from './token'

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

describe('token mobile Moodle', () => {
  const baseUrl = 'https://elearning.unipd.it/dlm'
  const passport = 'abc123'
  const siteId = createSiteId(baseUrl, passport)

  it('costruisce l’URL launch corretto', () => {
    const url = new URL(buildLaunchUrl(baseUrl, passport, 'moodle-vault'))
    expect(url.pathname).toBe('/dlm/admin/tool/mobile/launch.php')
    expect(url.searchParams.get('service')).toBe('moodle_mobile_app')
    expect(url.searchParams.get('passport')).toBe(passport)
    expect(url.searchParams.get('urlscheme')).toBe('moodle-vault')
  })

  it('calcola lo siteid come Moodle', () => {
    expect(siteId).toBe('8e31bff65d53c2c4ae9295168d8f2420')
  })

  it('decodifica il redirect con token, private token e siteid', () => {
    const payload = encode(`${siteId}:::token-value:::private-value`)
    const result = parseLaunchRedirect(`moodle-vault://token=${payload}`, siteId)
    expect(result).toEqual({
      token: 'token-value',
      privateToken: 'private-value',
      siteId
    })
  })

  it('accetta un redirect percent-encoded', () => {
    const payload = encode(`${siteId}:::token-value:::private-value`)
    const result = parseLaunchRedirect(
      `moodle-vault://token=${encodeURIComponent(payload)}`,
      siteId
    )
    expect(result?.token).toBe('token-value')
  })

  it('rifiuta uno siteid non corrispondente', () => {
    const payload = encode('altro:::token-value:::private-value')
    expect(parseLaunchRedirect(`moodle-vault://token=${payload}`, siteId)).toBeNull()
  })

  it('rifiuta redirect senza token', () => {
    expect(parseLaunchRedirect('https://elearning.unipd.it/dlm/my/')).toBeNull()
    expect(parseLaunchRedirect('moodle-vault://')).toBeNull()
  })
})
