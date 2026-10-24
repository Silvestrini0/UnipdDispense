import { useMemo, useState, type JSX } from 'react'
import type { MaterialCategory, MaterialFile } from '../../../shared/types'
import { useAppStore } from '../store'
import { formatDateTime, formatFileSize } from '../utils'
import {
  AlertIcon,
  ExternalIcon,
  FileIcon,
  FolderIcon,
  SearchIcon,
  SyncIcon
} from './Icons'

type CategoryFilter = 'all' | MaterialCategory
type TypeFilter = 'all' | 'pdf' | 'slides' | 'documents' | 'video' | 'notes' | 'other'
type SortOrder = 'name' | 'recent'

const PREVIEWABLE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'md', 'markdown'])
const SLIDES = new Set(['ppt', 'pptx', 'odp', 'key'])
const DOCUMENTS = new Set(['doc', 'docx', 'odt', 'xls', 'xlsx', 'ods', 'csv', 'txt', 'rtf'])
const VIDEOS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'm4a', 'wav', 'ogg'])

export function MaterialsView(): JSX.Element {
  const materials = useAppStore((state) => state.materials)
  const loading = useAppStore((state) => state.materialsLoading)
  const error = useAppStore((state) => state.materialsError)
  const refresh = useAppStore((state) => state.refreshMaterials)
  const open = useAppStore((state) => state.openMaterial)
  const preview = useAppStore((state) => state.previewMaterial)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortOrder>('name')
  const [showRemoved, setShowRemoved] = useState(false)

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('it')
    return materials
      .filter((file) => {
        if (!showRemoved && file.status === 'removed') return false
        if (category !== 'all' && file.category !== category) return false
        if (!matchesType(file, type)) return false
        if (!query) return true
        return `${file.filename} ${file.courseFolder} ${file.relativePath} ${file.moduleFolder}`
          .toLocaleLowerCase('it')
          .includes(query)
      })
      .sort((left, right) => {
        if (sort === 'recent') {
          return new Date(right.moodleModifiedAt ?? right.modifiedAt).getTime() -
            new Date(left.moodleModifiedAt ?? left.modifiedAt).getTime()
        }
        return left.filename.localeCompare(right.filename, 'it', { sensitivity: 'base' })
      })
  }, [materials, search, category, type, sort, showRemoved])

  const groups = useMemo(() => groupMaterials(filtered), [filtered])
  const materialCount = materials.filter((file) => file.category === 'material').length
  const infoCount = materials.filter((file) => file.category === 'info').length

  return (
    <div className="view materials-view">
      <section className="materials-intro card">
        <div className="materials-intro__icon"><FolderIcon /></div>
        <div className="materials-intro__copy">
          <span className="eyebrow">Il tuo archivio</span>
          <h2>Trova subito quello che ti serve</h2>
          <p>Lezioni, appunti e dispense sono raccolti per corso e sezione. Le informazioni generali restano a parte.</p>
        </div>
        <div className="materials-intro__counts">
          <span><strong>{materialCount}</strong> materiali</span>
          <span><strong>{infoCount}</strong> informazioni</span>
        </div>
      </section>

      <section className="materials-toolbar card" aria-label="Filtri materiali">
        <label className="search-field materials-search">
          <SearchIcon />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca file, corso o lezione"
            aria-label="Cerca file, corso o lezione"
          />
        </label>
        <div className="materials-filters">
          <label>
            <span>Cartella</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as CategoryFilter)}>
              <option value="all">Tutte</option>
              <option value="material">Materiali</option>
              <option value="info">Informazioni</option>
            </select>
          </label>
          <label>
            <span>Formato</span>
            <select value={type} onChange={(event) => setType(event.target.value as TypeFilter)}>
              <option value="all">Tutti</option>
              <option value="pdf">PDF</option>
              <option value="slides">Slide</option>
              <option value="documents">Documenti</option>
              <option value="video">Audio e video</option>
              <option value="notes">Note</option>
              <option value="other">Altri file</option>
            </select>
          </label>
          <label>
            <span>Ordina</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortOrder)}>
              <option value="name">Nome</option>
              <option value="recent">Più recenti</option>
            </select>
          </label>
          <label className="materials-removed-toggle">
            <input type="checkbox" checked={showRemoved} onChange={(event) => setShowRemoved(event.target.checked)} />
            <span>Mostra rimossi</span>
          </label>
          <button type="button" className="button button--secondary" onClick={() => void refresh()} disabled={loading}>
            <SyncIcon className={loading ? 'spin' : undefined} />
            Aggiorna
          </button>
        </div>
      </section>

      {error ? (
        <section className="empty-state card">
          <span className="empty-state__icon"><AlertIcon /></span>
          <h2>Impossibile leggere il vault</h2>
          <p>{error}</p>
          <button type="button" className="button button--secondary" onClick={() => void refresh()}>Riprova</button>
        </section>
      ) : loading && materials.length === 0 ? (
        <section className="empty-state card"><span className="spinner" /><h2>Carico i materiali…</h2></section>
      ) : filtered.length === 0 ? (
        <section className="empty-state card">
          <span className="empty-state__icon"><FileIcon /></span>
          <h2>{materials.length === 0 ? 'Il vault è ancora vuoto' : 'Nessun file corrisponde ai filtri'}</h2>
          <p>{materials.length === 0
            ? 'Sincronizza i tuoi corsi Moodle e i file appariranno qui, organizzati per corso.'
            : 'Prova a cambiare la ricerca o i filtri selezionati.'}</p>
          {materials.length === 0 && <button type="button" className="button button--secondary" onClick={() => void useAppStore.getState().startSync({ reason: 'manual' })}>Sincronizza ora</button>}
        </section>
      ) : (
        <div className="materials-tree">
          {groups.map((course) => (
            <details className="material-course card" key={course.name} open>
              <summary className="material-course__summary">
                <span className="material-course__folder"><FolderIcon /></span>
                <span className="material-course__name">{course.name}</span>
                <span className="material-course__count">{course.count} file</span>
              </summary>
              <div className="material-course__body">
                {course.categories.map((bucket) => (
                  <details className="material-category" key={bucket.category} open>
                    <summary>
                      <span className={`material-category__dot material-category__dot--${bucket.category}`} />
                      <strong>{bucket.category === 'material' ? 'Materiali' : 'Informazioni'}</strong>
                      <span>{bucket.count}</span>
                    </summary>
                    <div className="material-category__body">
                      {bucket.sections.map((section) => (
                        <details className="material-section" key={section.name} open>
                          <summary><span>{section.name}</span><span>{section.files.length}</span></summary>
                          <div className="material-file-list">
                            {section.files.map((file) => (
                              <MaterialRow key={file.relativePath} file={file} open={open} preview={preview} />
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
      <div className="materials-footnote">{filtered.length} file mostrati · Apri usa l’app predefinita del computer; Anteprima è disponibile per PDF, immagini e note.</div>
    </div>
  )
}

function MaterialRow({
  file,
  open,
  preview
}: {
  file: MaterialFile
  open: (relativePath: string, mode?: 'default' | 'folder') => Promise<void>
  preview: (relativePath: string) => Promise<void>
}): JSX.Element {
  const format = formatLabel(file)
  const date = file.moodleModifiedAt ?? file.modifiedAt
  return (
    <div className={`material-row ${file.status === 'removed' ? 'material-row--removed' : ''}`}>
      <span className="material-row__icon"><FileIcon /></span>
      <div className="material-row__copy">
        <strong title={file.filename}>{file.filename}</strong>
        <span>{file.moduleFolder || file.sectionFolder} · {formatFileSize(file.size)} · {formatDateTime(date)}</span>
      </div>
      <div className="material-row__badges">
        <span className="chip">{format}</span>
        {file.status === 'removed' && <span className="chip chip--removed">Rimosso</span>}
      </div>
      <div className="material-row__actions">
        <button type="button" className="icon-button" onClick={() => void open(file.relativePath)} title="Apri con l’app predefinita" aria-label={`Apri ${file.filename}`}>
          <ExternalIcon />
        </button>
        {PREVIEWABLE.has(file.extension) && (
          <button type="button" className="button button--ghost material-preview-button" onClick={() => void preview(file.relativePath)}>Anteprima</button>
        )}
        <button type="button" className="icon-button" onClick={() => void open(file.relativePath, 'folder')} title="Mostra nella cartella" aria-label={`Mostra ${file.filename} nella cartella`}>
          <FolderIcon />
        </button>
      </div>
    </div>
  )
}

function matchesType(file: MaterialFile, type: TypeFilter): boolean {
  if (type === 'all') return true
  if (type === 'pdf') return file.extension === 'pdf'
  if (type === 'slides') return SLIDES.has(file.extension)
  if (type === 'documents') return DOCUMENTS.has(file.extension)
  if (type === 'video') return VIDEOS.has(file.extension)
  if (type === 'notes') return file.kind === 'note' || ['md', 'markdown'].includes(file.extension)
  return !SLIDES.has(file.extension) && !DOCUMENTS.has(file.extension) && !VIDEOS.has(file.extension) && file.extension !== 'pdf' && file.kind !== 'note'
}

function formatLabel(file: MaterialFile): string {
  if (file.kind === 'note' || ['md', 'markdown'].includes(file.extension)) return 'Nota'
  if (SLIDES.has(file.extension)) return 'Slide'
  if (DOCUMENTS.has(file.extension)) return 'Documento'
  if (VIDEOS.has(file.extension)) return file.mimeType.startsWith('audio/') ? 'Audio' : 'Media'
  return file.extension ? file.extension.toUpperCase() : 'File'
}

interface SectionGroup {
  name: string
  files: MaterialFile[]
}

interface CategoryGroup {
  category: MaterialCategory
  count: number
  sections: SectionGroup[]
}

interface CourseGroup {
  name: string
  count: number
  categories: CategoryGroup[]
}

function groupMaterials(files: MaterialFile[]): CourseGroup[] {
  const courses = new Map<string, Map<MaterialCategory, Map<string, MaterialFile[]>>>()
  for (const file of files) {
    let categories = courses.get(file.courseFolder)
    if (!categories) {
      categories = new Map()
      courses.set(file.courseFolder, categories)
    }
    let sections = categories.get(file.category)
    if (!sections) {
      sections = new Map()
      categories.set(file.category, sections)
    }
    const section = file.sectionFolder || 'Senza sezione'
    const sectionFiles = sections.get(section) ?? []
    sectionFiles.push(file)
    sections.set(section, sectionFiles)
  }
  return [...courses.entries()].map(([name, categories]) => {
    const groupedCategories: CategoryGroup[] = [...categories.entries()].map(([category, sections]) => ({
      category,
      count: [...sections.values()].reduce((total, items) => total + items.length, 0),
      sections: [...sections.entries()].map(([sectionName, sectionFiles]) => ({
        name: sectionName,
        files: sectionFiles
      }))
    })).sort((left, right) => left.category === 'material' ? -1 : right.category === 'material' ? 1 : 0)
    return {
      name,
      count: groupedCategories.reduce((total, item) => total + item.count, 0),
      categories: groupedCategories
    }
  })
}
