import type { CourseSummary } from '../shared/types'
import { AuthService } from './auth/auth-service'
import { toCourseSummary } from './sync/planner'

export class CourseService {
  constructor(private readonly auth: AuthService) {}

  async list(): Promise<CourseSummary[]> {
    return this.auth.withApi(async (api) => {
      const siteInfo = await api.getSiteInfo()
      const courses = await api.getUsersCourses(siteInfo.userid)
      return courses
        .map(toCourseSummary)
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName, 'it', { sensitivity: 'base' })
        )
    })
  }
}
