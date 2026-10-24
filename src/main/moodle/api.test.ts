import { describe, expect, it } from 'vitest'
import { MoodleApi, MoodleApiError } from './api'

const baseUrl = 'https://elearning.unipd.it/dlm'
const fileUrl = `${baseUrl}/pluginfile.php/1/mod_resource/content/1/file.pdf`

function responseAt(url: string, status = 200): Response {
  const response = new Response('contenuto', { status })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

describe('MoodleApi.fetchFile', () => {
  it('rifiuta domini esterni', async () => {
    const api = new MoodleApi(baseUrl, 'token')
    await expect(
      api.fetchFile('https://evil.example/pluginfile.php/file.pdf')
    ).rejects.toMatchObject({ code: 'invalid_file_origin' })
  })

  it('rifiuta URL che non sono pluginfile', async () => {
    const api = new MoodleApi(baseUrl, 'token')
    await expect(api.fetchFile(`${baseUrl}/course/view.php?id=1`)).rejects.toMatchObject({
      code: 'invalid_file_url'
    })
  })

  it('aggiunge il token e accetta un download pluginfile', async () => {
    let requested = ''
    const fetchImpl: typeof fetch = async (input) => {
      requested = String(input)
      return responseAt(fileUrl)
    }
    const api = new MoodleApi(baseUrl, 'token-segreto', fetchImpl)
    const response = await api.fetchFile(fileUrl)
    expect(response.status).toBe(200)
    expect(requested).toContain('token=token-segreto')
  })

  it('riconosce un redirect al login come token scaduto', async () => {
    const fetchImpl: typeof fetch = async () =>
      responseAt(`${baseUrl}/login/index.php?reason=session_expired`)
    const api = new MoodleApi(baseUrl, 'token', fetchImpl)
    await expect(api.fetchFile(fileUrl)).rejects.toMatchObject({
      code: 'invalidtoken'
    })
  })

  it('rifiuta redirect verso host esterni o percorsi non file', async () => {
    const external: typeof fetch = async () =>
      responseAt('https://evil.example/file.pdf')
    await expect(
      new MoodleApi(baseUrl, 'token', external).fetchFile(fileUrl)
    ).rejects.toMatchObject({ code: 'invalid_file_redirect' })

    const wrongPath: typeof fetch = async () => responseAt(`${baseUrl}/course/view.php?id=1`)
    await expect(
      new MoodleApi(baseUrl, 'token', wrongPath).fetchFile(fileUrl)
    ).rejects.toMatchObject({ code: 'invalid_file_redirect' })
  })
})

describe('MoodleApiError', () => {
  it('mantiene codice e stato HTTP', () => {
    const error = new MoodleApiError('errore', 'http_500', 500)
    expect(error).toMatchObject({ message: 'errore', code: 'http_500', status: 500 })
  })
})
