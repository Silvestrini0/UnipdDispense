import { logger } from '../logger'
import type {
  MoodleCourse,
  MoodleSection,
  MoodleSiteInfo,
  MoodleWarning
} from './types'

interface MoodleErrorResponse {
  exception?: string
  errorcode?: string
  message?: string
}

export class MoodleApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'MoodleApiError'
  }
}

type FetchLike = typeof fetch
type MoodleCallResponse<T> = T & { warnings?: MoodleWarning[] }

export class MoodleApi {
  private readonly baseUrl: string

  constructor(
    baseUrl: string,
    readonly token: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async getSiteInfo(): Promise<MoodleSiteInfo> {
    return this.call<MoodleSiteInfo>('core_webservice_get_site_info')
  }

  async getUsersCourses(userId: number): Promise<MoodleCourse[]> {
    return this.call<MoodleCourse[]>('core_enrol_get_users_courses', {
      userid: String(userId)
    })
  }

  async getCourseContents(courseId: number): Promise<MoodleSection[]> {
    return this.call<MoodleSection[]>('core_course_get_contents', {
      courseid: String(courseId)
    })
  }

  async fetchFile(fileUrl: string): Promise<Response> {
    const url = new URL(fileUrl)
    const base = new URL(this.baseUrl)
    if (url.origin !== base.origin) {
      throw new MoodleApiError(
        'Il file proviene da un dominio non riconosciuto.',
        'invalid_file_origin'
      )
    }
    if (!url.pathname.includes('pluginfile.php')) {
      throw new MoodleApiError(
        'L’URL del file non è un endpoint pluginfile.',
        'invalid_file_url'
      )
    }
    if (!url.searchParams.has('token') && !url.searchParams.has('wstoken')) {
      url.searchParams.set('token', this.token)
    }
    const response = await this.fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000)
    })
    if (!response.ok) {
      throw new MoodleApiError(
        `Download fallito (HTTP ${response.status}).`,
        `http_${response.status}`,
        response.status
      )
    }
    if (response.url) {
      const finalUrl = new URL(response.url)
      if (finalUrl.origin !== base.origin || !finalUrl.pathname.includes('pluginfile.php')) {
        const loginRedirect =
          finalUrl.pathname.includes('/login/') || finalUrl.pathname.includes('/auth/')
        throw new MoodleApiError(
          loginRedirect
            ? 'La sessione Moodle è scaduta durante il download.'
            : 'Il download è stato reindirizzato a una destinazione non valida.',
          loginRedirect ? 'invalidtoken' : 'invalid_file_redirect'
        )
      }
    }
    return response
  }

  private async call<T>(fn: string, params: Record<string, string> = {}): Promise<T> {
    const body = new URLSearchParams({
      wstoken: this.token,
      wsfunction: fn,
      moodlewsrestformat: 'json',
      ...params
    })
    let response: Response
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/webservice/rest/server.php`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            Accept: 'application/json'
          },
          body,
          signal: AbortSignal.timeout(30_000)
        }
      )
    } catch (error) {
      throw new MoodleApiError(
        `Impossibile contattare Moodle: ${error instanceof Error ? error.message : String(error)}`,
        'network_error'
      )
    }
    let payload: MoodleCallResponse<T> | MoodleErrorResponse
    try {
      payload = (await response.json()) as MoodleCallResponse<T> | MoodleErrorResponse
    } catch {
      throw new MoodleApiError(
        `Risposta non valida da Moodle (HTTP ${response.status}).`,
        'invalid_response',
        response.status
      )
    }
    const error = payload as MoodleErrorResponse
    if (error.exception || error.errorcode) {
      throw new MoodleApiError(
        error.message || 'Errore restituito da Moodle.',
        error.errorcode || 'moodle_error',
        response.status
      )
    }
    const warnings = (payload as MoodleCallResponse<T>).warnings
    if (warnings && warnings.length > 0) {
      logger.warn(
        `Moodle API ${fn}: ${warnings
          .map((warning) => `${warning.warningcode}${warning.message ? ` (${warning.message})` : ''}`)
          .join('; ')}`
      )
    }
    if (!response.ok) {
      throw new MoodleApiError(
        `Moodle ha risposto con HTTP ${response.status}.`,
        `http_${response.status}`,
        response.status
      )
    }
    return payload as T
  }
}
