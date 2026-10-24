import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import type { RecentAddedFile } from '../../../shared/types'
import { useAppStore } from '../store'
import { courseColor, formatDateTime } from '../utils'
import { AlertIcon, ExternalIcon, FileIcon } from './Icons'

export function RecentFilesCard(): JSX.Element {
  const courses = useAppStore((state) => state.courses)
  const syncFinishedAt = useAppStore((state) => state.sync.finishedAt)
  const openMaterial = useAppStore((state) => state.openMaterial)
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null)
  const [files, setFiles] = useState<RecentAddedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void window.api.materials
      .recentAdded(selectedCourseId)
      .then((recentFiles) => {
        if (active) setFiles(recentFiles)
      })
      .catch((reason: unknown) => {
        if (active) {
          setFiles([])
          setError(reason instanceof Error ? reason.message : 'Impossibile caricare i file recenti.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedCourseId, syncFinishedAt, refreshKey])

  return (
    <section className="card recent-files" aria-busy={loading}>
      <div className="recent-files__header">
        <div className="recent-files__title">
          <span className="eyebrow">Aggiornamenti Moodle</span>
          <h2>Ultimi file aggiunti</h2>
          <p>Gli ultimi 10 file rilevati durante le sincronizzazioni.</p>
        </div>
        <div className="recent-files__filters" role="group" aria-label="Filtra i file per corso">
          <button
            type="button"
            className={`recent-files__filter${selectedCourseId === null ? ' is-active' : ''}`}
            aria-pressed={selectedCourseId === null}
            onClick={() => setSelectedCourseId(null)}
          >
            Tutti
          </button>
          {courses.map((course) => (
            <button
              type="button"
              key={course.id}
              className={`recent-files__filter${selectedCourseId === course.id ? ' is-active' : ''}`}
              style={{ '--course-accent': courseColor(course.id) } as CSSProperties}
              title={course.displayName}
              aria-pressed={selectedCourseId === course.id}
              onClick={() => setSelectedCourseId(course.id)}
            >
              {course.displayName}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="recent-files__loading" role="status">Aggiorno l’elenco…</div>
      ) : error ? (
        <div className="recent-files__empty recent-files__empty--error">
          <AlertIcon />
          <span>{error}</span>
          <button type="button" className="text-button" onClick={() => setRefreshKey((key) => key + 1)}>
            Riprova
          </button>
        </div>
      ) : files.length === 0 ? (
        <div className="recent-files__empty">
          <FileIcon />
          <span>Non ci sono ancora nuovi file rilevati. Compariranno qui dopo una sincronizzazione.</span>
        </div>
      ) : (
        <ol className="recent-files__list">
          {files.map((file) => {
            const addedAt = file.moodleAddedAt ?? file.detectedAt
            return (
              <li key={file.relativePath} className="recent-files__item">
                <span className="recent-files__file-icon" aria-hidden="true">
                  <FileIcon />
                </span>
                <span className="recent-files__copy">
                  <strong title={file.filename}>{file.filename}</strong>
                  <small>
                    {file.courseName}
                    {file.sectionName ? ` · ${file.sectionName}` : ''}
                    {file.moduleName ? ` · ${file.moduleName}` : ''}
                  </small>
                </span>
                <time className="recent-files__date" dateTime={addedAt} title={
                  file.moodleAddedAt ? 'Data di caricamento indicata da Moodle' : 'Data di rilevamento'
                }>
                  {formatDateTime(addedAt)}
                </time>
                <button
                  type="button"
                  className="recent-files__open"
                  onClick={() => void openMaterial(file.relativePath)}
                  aria-label={`Apri ${file.filename}`}
                >
                  <ExternalIcon />
                  <span>Apri</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
