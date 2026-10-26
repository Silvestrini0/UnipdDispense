import { useMemo, useState, type JSX } from 'react'
import type { CourseSummary } from '../../../shared/types'
import { useAppStore } from '../store'
import {
  courseColor,
  formatUnixDate,
  initials,
  pluralize
} from '../utils'
import {
  AlertIcon,
  BookIcon,
  CheckIcon,
  SearchIcon,
  SyncIcon
} from './Icons'
import { Switch } from './Switch'

export function CoursesView(): JSX.Element {
  const courses = useAppStore((state) => state.courses)
  const coursesLoading = useAppStore((state) => state.coursesLoading)
  const coursesError = useAppStore((state) => state.coursesError)
  const settings = useAppStore((state) => state.settings)
  const settingsSaving = useAppStore((state) => state.settingsSaving)
  const sync = useAppStore((state) => state.sync)
  const saveSettings = useAppStore((state) => state.saveSettings)
  const refreshCourses = useAppStore((state) => state.refreshCourses)
  const startSync = useAppStore((state) => state.startSync)
  const [search, setSearch] = useState('')
  const [keptCourseIds, setKeptCourseIds] = useState<Set<number>>(() => new Set())

  const allMode = settings?.syncAllCourses ?? true
  const selectedIds = settings?.selectedCourseIds ?? []
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return courses
    }
    return courses.filter(
      (course) =>
        course.displayName.toLowerCase().includes(query) ||
        course.shortname.toLowerCase().includes(query)
    )
  }, [courses, search])

  const checkedCount = allMode
    ? courses.length
    : courses.filter((course) => selectedSet.has(course.id)).length
  const hasSelection = checkedCount > 0

  const toggleAllMode = (enabled: boolean): void => {
    if (enabled) {
      void saveSettings({ syncAllCourses: true, selectedCourseIds: [] })
    } else {
      void saveSettings({
        syncAllCourses: false,
        selectedCourseIds: courses.map((course) => course.id)
      })
    }
  }

  const toggleCourse = (course: CourseSummary): void => {
    if (!settings || settingsSaving) {
      return
    }
    const base = allMode ? new Set(courses.map((item) => item.id)) : new Set(selectedIds)
    if (allMode || selectedSet.has(course.id)) {
      base.delete(course.id)
    } else {
      base.add(course.id)
    }
    if (base.size === courses.length) {
      void saveSettings({ syncAllCourses: true, selectedCourseIds: [] })
    } else {
      void saveSettings({
        syncAllCourses: false,
        selectedCourseIds: [...base]
      })
    }
  }

  const syncSelection = async (): Promise<void> => {
    if (!hasSelection || settingsSaving) {
      return
    }
    const courseIds = allMode
      ? courses.map((course) => course.id)
      : courses.filter((course) => selectedSet.has(course.id)).map((course) => course.id)
    const keptIds = new Set(keptCourseIds)
    for (const courseId of courseIds) keptIds.delete(courseId)
    setKeptCourseIds(keptIds)
    let deleteCourseIds: number[] = []
    if (!allMode) {
      try {
        const unselectedFolders = (
          await window.api.sync.listUnselectedCourseFolders(courseIds)
        ).filter((course) => !keptIds.has(course.courseId))
        if (unselectedFolders.length > 0) {
          const names = unselectedFolders.map((course) => `• ${course.courseName}`).join('\n')
          const confirmed = window.confirm(
            `Vuoi eliminare le cartelle dei corsi rimossi dalla selezione?\n\n${names}\n\n` +
              'Verranno eliminati anche tutti i file contenuti in queste cartelle.'
          )
          if (confirmed) {
            deleteCourseIds = unselectedFolders.map((course) => course.courseId)
          } else {
            setKeptCourseIds(
              (current) =>
                new Set([...current, ...unselectedFolders.map((course) => course.courseId)])
            )
          }
        }
      } catch {
        // The sync still proceeds; stale folders remain untouched if they cannot be listed.
      }
    }
    await startSync({
      reason: 'manual',
      courseIds,
      ...(deleteCourseIds.length ? { deleteCourseIds } : {})
    })
  }

  return (
    <div className="view courses-view">
      <section className="toolbar card">
        <div className="toolbar__selection">
          <Switch
            checked={allMode}
            onChange={toggleAllMode}
            disabled={settingsSaving}
            label="Sincronizza tutti i corsi"
          />
          <div>
            <strong>Tutti i corsi</strong>
            <span>
              {allMode
                ? 'I nuovi corsi verranno inclusi automaticamente.'
                : `${pluralize(checkedCount, 'corso selezionato', 'corsi selezionati')} su ${courses.length}.`}
            </span>
          </div>
        </div>
        <div className="toolbar__actions">
          <label className="search-field">
            <SearchIcon />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cerca un corso"
              aria-label="Cerca un corso"
            />
          </label>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void syncSelection()}
            disabled={sync.running || settingsSaving || !hasSelection}
          >
            <SyncIcon className={sync.running ? 'spin' : undefined} />
            {sync.running ? 'Sincronizzazione…' : 'Sincronizza selezione'}
          </button>
        </div>
      </section>

      {!allMode && !hasSelection && (
        <div className="alert alert--warning">
          <AlertIcon />
          <span>Nessun corso selezionato: la sincronizzazione automatica non scaricherà nulla.</span>
        </div>
      )}

      {coursesLoading ? (
        <div className="course-grid">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="course-card course-card--skeleton">
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : coursesError ? (
        <section className="empty-state card">
          <span className="empty-state__icon">
            <AlertIcon />
          </span>
          <h2>Impossibile caricare i corsi</h2>
          <p>{coursesError}</p>
          <button type="button" className="button button--secondary" onClick={() => void refreshCourses()}>
            Riprova
          </button>
        </section>
      ) : filtered.length === 0 ? (
        <section className="empty-state card">
          <span className="empty-state__icon">
            <BookIcon />
          </span>
          <h2>{search ? 'Nessun risultato' : 'Nessun corso disponibile'}</h2>
          <p>
            {search
              ? 'Prova con un altro nome o con il codice del corso.'
              : 'Nel profilo Moodle non risultano corsi attivi.'}
          </p>
          {!search && (
            <button type="button" className="button button--secondary" onClick={() => void refreshCourses()}>
              Aggiorna elenco
            </button>
          )}
        </section>
      ) : (
        <div className="course-grid">
          {filtered.map((course) => {
            const checked = allMode || selectedSet.has(course.id)
            return (
              <label
                key={course.id}
                className={`course-card ${checked ? 'course-card--selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCourse(course)}
                  disabled={settingsSaving}
                />
                <span className="course-card__check" aria-hidden="true">
                  <CheckIcon />
                </span>
                <span
                  className="course-avatar"
                  style={{ background: courseColor(course.id) }}
                  aria-hidden="true"
                >
                  {initials(course.displayName)}
                </span>
                <span className="course-card__body">
                  <span className="course-card__topline">
                    <strong>{course.displayName}</strong>
                    <span className="chip">{course.shortname}</span>
                  </span>
                  {course.summary && <span className="course-card__summary">{course.summary}</span>}
                  <span className="course-card__meta">
                    {course.startDate ? `Inizio ${formatUnixDate(course.startDate)}` : 'Data non disponibile'}
                    {course.endDate ? ` · Fine ${formatUnixDate(course.endDate)}` : ''}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
