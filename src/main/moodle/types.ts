export interface MoodleFunctionInfo {
  name: string
  version: string
}

export interface MoodleSiteInfo {
  sitename: string
  username: string
  firstname: string
  lastname: string
  fullname: string
  userid: number
  siteurl: string
  release?: string
  functions: MoodleFunctionInfo[]
}

export interface MoodleCourse {
  id: number
  shortname: string
  fullname: string
  displayname?: string
  enrolledusercount?: number
  idnumber?: string
  visible: number
  summary?: string
  summaryformat?: number
  format?: string
  category?: number
  startdate?: number
  enddate?: number
  timemodified?: number
}

export interface MoodleContent {
  type: string
  filename: string
  filepath: string
  filesize: number
  fileurl?: string
  content?: string
  timecreated?: number
  timemodified?: number
  sortorder?: number
  userid?: number
  author?: string
  license?: string
  mimetype?: string
  isexternalfile?: boolean
  repositorytype?: string
}

export interface MoodleModule {
  id: number
  url?: string
  name: string
  instance?: number
  description?: string
  visible: number
  uservisible: boolean
  visibleoncoursepage?: number
  modname: string
  modplural?: string
  indent?: number
  onclick?: string
  afterlink?: string
  customdata?: string
  contents?: MoodleContent[]
}

export interface MoodleSection {
  id: number
  name: string
  visible: number
  summary?: string
  summaryformat?: number
  modules: MoodleModule[]
}

export interface MoodleWarning {
  item?: string
  itemid?: number
  warningcode: string
  message: string
}
