import { readdir, realpath, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, shell } from 'electron'
import type { SettingsStore } from './settings-store'
import type { MaterialFile } from '../shared/types'
import type { ManifestEntry } from './sync/manifest'
import { ManifestStore } from './sync/manifest'

const EXCLUDED_DIRECTORIES = new Set(['.obsidian', '.moodlescraper', 'Schede file'])
const EXCLUDED_FILES = new Set(['Indice corso.md', 'Rimossi da Moodle.md'])
const BLOCKED_EXTENSIONS = new Set([
  'app', 'appimage', 'apk', 'bat', 'bash', 'bin', 'cmd', 'com', 'cpl', 'desktop',
  'dll', 'dmg', 'exe', 'fish', 'htm', 'html', 'hta', 'jar', 'js', 'mjs', 'cjs',
  'lua', 'msi', 'php', 'pkg', 'pl', 'ps1', 'psm1', 'py', 'pyw', 'rb', 'rpm',
  'run', 'sh', 'so', 'svg', 'vbs', 'wasm', 'xhtml', 'zsh'
])
const PREVIEW_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'md', 'markdown'
])
const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  zip: 'application/zip'
}

interface SafeFile {
  absolutePath: string
  extension: string
  size: number
}

export class MaterialsService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly getMainWindow: () => BrowserWindow | null
  ) {}

  async list(): Promise<MaterialFile[]> {
    const vaultPath = resolve(this.settings.get().vaultPath)
    let root: string
    try {
      root = await realpath(vaultPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }

    const manifest = await new ManifestStore(root).load()
    const entries = new Map<string, ManifestEntry>()
    for (const entry of Object.values(manifest.entries)) {
      entries.set(entry.relativePath.toLowerCase(), entry)
    }

    const files: MaterialFile[] = []
    await scanDirectory(root, root, entries, files)
    return files.sort((left, right) => {
      const byCourse = left.courseFolder.localeCompare(right.courseFolder, 'it', {
        sensitivity: 'base'
      })
      if (byCourse !== 0) return byCourse
      const byCategory = left.category.localeCompare(right.category)
      if (byCategory !== 0) return byCategory
      const bySection = left.sectionFolder.localeCompare(right.sectionFolder, 'it', {
        numeric: true,
        sensitivity: 'base'
      })
      if (bySection !== 0) return bySection
      return left.filename.localeCompare(right.filename, 'it', { sensitivity: 'base' })
    })
  }

  async open(relativePath: string, mode: 'default' | 'folder'): Promise<void> {
    const file = await this.resolveFile(relativePath)
    const target = mode === 'folder' ? dirname(file.absolutePath) : file.absolutePath
    const error = await shell.openPath(target)
    if (error) {
      throw new Error(error)
    }
  }

  async preview(relativePath: string): Promise<void> {
    const file = await this.resolveFile(relativePath)
    if (!PREVIEW_EXTENSIONS.has(file.extension)) {
      throw new Error('Anteprima non disponibile per questo formato.')
    }
    if (file.size > 120 * 1024 * 1024) {
      throw new Error('Il file è troppo grande per l’anteprima (limite 120 MB).')
    }
    const isMarkdown = file.extension === 'md' || file.extension === 'markdown'
    if (isMarkdown && file.size > 4 * 1024 * 1024) {
      throw new Error('La nota è troppo grande per l’anteprima (limite 4 MB).')
    }

    const targetUrl = isMarkdown
      ? `data:text/html;charset=utf-8,${encodeURIComponent(
          renderMarkdownPreview(basename(file.absolutePath), await readFile(file.absolutePath, 'utf8'))
        )}`
      : pathToFileURL(file.absolutePath).toString()
    const preview = new BrowserWindow({
      width: 1080,
      height: 820,
      minWidth: 620,
      minHeight: 480,
      show: false,
      title: basename(file.absolutePath),
      backgroundColor: '#f4f7fc',
      autoHideMenuBar: true,
      parent: this.getMainWindow() ?? undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        javascript: !isMarkdown,
        devTools: false
      }
    })
    const allowTarget = (url: string): boolean => {
      if (isMarkdown) return url === targetUrl
      try {
        const requested = new URL(url)
        const initial = new URL(targetUrl)
        return requested.protocol === 'file:' && requested.pathname === initial.pathname
      } catch {
        return false
      }
    }
    preview.webContents.setWindowOpenHandler(({ url }) => {
      openExternalHttps(url)
      return { action: 'deny' }
    })
    preview.webContents.on('will-navigate', (event, url) => {
      if (allowTarget(url)) return
      event.preventDefault()
      openExternalHttps(url)
    })
    preview.once('ready-to-show', () => preview.show())
    await preview.loadURL(targetUrl)
  }

  private async resolveFile(relativePath: string): Promise<SafeFile> {
    if (
      typeof relativePath !== 'string' ||
      relativePath.length === 0 ||
      relativePath.includes('\\') ||
      relativePath.includes('\0') ||
      relativePath.startsWith('/') ||
      relativePath.split('/').some((part) => part === '' || part === '.' || part === '..')
    ) {
      throw new Error('Percorso del file non valido.')
    }
    const vaultPath = resolve(this.settings.get().vaultPath)
    const root = await realpath(vaultPath)
    const candidate = resolve(root, ...relativePath.split('/'))
    const actual = await realpath(candidate)
    const relation = relative(root, actual)
    if (relation === '..' || relation.startsWith(`..${sep}`) || resolve(actual) === root) {
      throw new Error('Il percorso del file esce dal vault configurato.')
    }
    const info = await stat(actual)
    if (!info.isFile()) {
      throw new Error('Il percorso selezionato non è un file.')
    }
    const extension = extname(actual).slice(1).toLowerCase()
    if (BLOCKED_EXTENSIONS.has(extension)) {
      throw new Error('Questo tipo di file non può essere aperto dall’app.')
    }
    return { absolutePath: actual, extension, size: info.size }
  }
}

async function scanDirectory(
  root: string,
  directory: string,
  entries: Map<string, ManifestEntry>,
  files: MaterialFile[]
): Promise<void> {
  const children = await readdir(directory, { withFileTypes: true })
  for (const child of children) {
    if (child.isSymbolicLink()) continue
    if (child.isDirectory()) {
      if (directory === root && EXCLUDED_DIRECTORIES.has(child.name)) continue
      await scanDirectory(root, resolve(directory, child.name), entries, files)
      continue
    }
    if (!child.isFile() || EXCLUDED_FILES.has(child.name)) continue
    const absolutePath = resolve(directory, child.name)
    const pathFromRoot = relative(root, absolutePath)
    const relativePath = pathFromRoot.split(sep).join('/')
    const info = await stat(absolutePath)
    const entry = entries.get(relativePath.toLowerCase())
    const parts = relativePath.split('/')
    const bucket = parts[1]
    const category = entry?.category ?? (bucket === 'Informazioni' ? 'info' : 'material')
    const sectionFolder = entry?.sectionFolder ?? parts[2] ?? 'Senza sezione'
    const moduleFolder = entry?.moduleFolder ?? parts.slice(3, -1).join('/')
    const extension = extname(child.name).slice(1).toLowerCase()
    files.push({
      relativePath,
      filename: child.name,
      courseFolder: entry?.courseFolder ?? parts[0] ?? 'Altri file',
      category,
      sectionFolder,
      moduleFolder,
      extension,
      mimeType: entry?.mimeType || MIME_TYPES[extension] || 'application/octet-stream',
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      moodleModifiedAt: entry?.moodleModifiedAt ?? null,
      status: entry?.status ?? 'present',
      kind: entry?.kind ?? (extension === 'md' || extension === 'markdown' ? 'note' : 'file'),
      managed: Boolean(entry)
    })
  }
}

function renderMarkdownPreview(title: string, content: string): string {
  const escapedTitle = escapeHtml(title)
  const rendered = renderMarkdown(content)
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapedTitle}</title><style>body{margin:0;background:#f4f7fc;color:#172033;font:16px/1.7 system-ui,sans-serif}.page{max-width:900px;margin:40px auto;padding:40px;background:#fff;border:1px solid #dbe3ee;border-radius:18px;box-shadow:0 12px 30px #0f172a12}h1{font-size:1.3rem;margin:0 0 1.5rem;color:#1d4ed8}article h1,article h2,article h3{margin:1.3em 0 .45em;line-height:1.3}article h1{font-size:1.55rem}article h2{font-size:1.3rem}article h3{font-size:1.1rem}p,ul,ol,blockquote,pre{margin:.8em 0}blockquote{padding:.15em 1em;border-left:3px solid #93c5fd;color:#516078;background:#f8fafc}pre{overflow:auto;padding:1em;border-radius:10px;background:#0f172a;color:#e2e8f0}code{padding:.12em .32em;border-radius:4px;background:#eef2f8;font: .9em ui-monospace,SFMono-Regular,Consolas,monospace}pre code{padding:0;background:transparent}a{color:#1d4ed8}hr{border:0;border-top:1px solid #dbe3ee;margin:1.5em 0}@media(max-width:700px){.page{margin:0;padding:22px;border:0;border-radius:0}}</style></head><body><main class="page"><h1>${escapedTitle}</h1><article>${rendered}</article></main></body></html>`
}

function renderMarkdown(content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []
  let list: 'ul' | 'ol' | null = null
  let quote: string[] = []
  let code: string[] | null = null

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      html.push(`<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>`)
      paragraph = []
    }
  }
  const closeList = (): void => {
    if (list) html.push(`</${list}>`)
    list = null
  }
  const flushQuote = (): void => {
    if (quote.length > 0) {
      html.push(`<blockquote><p>${quote.map(renderInlineMarkdown).join('<br>')}</p></blockquote>`)
      quote = []
    }
  }

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flushParagraph()
      closeList()
      flushQuote()
      if (code) {
        html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
        code = null
      } else {
        code = []
      }
      continue
    }
    if (code) {
      code.push(line)
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      closeList()
      flushQuote()
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      closeList()
      flushQuote()
      const level = heading[1]?.length ?? 1
      html.push(`<h${level}>${renderInlineMarkdown(heading[2] ?? '')}</h${level}>`)
      continue
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph()
      closeList()
      flushQuote()
      html.push('<hr>')
      continue
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line)
    if (quoted) {
      flushParagraph()
      closeList()
      quote.push(quoted[1] ?? '')
      continue
    }
    flushQuote()
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (unordered || ordered) {
      flushParagraph()
      const nextList = unordered ? 'ul' : 'ol'
      if (list !== nextList) {
        closeList()
        list = nextList
        html.push(`<${list}>`)
      }
      html.push(`<li>${renderInlineMarkdown(unordered?.[1] ?? ordered?.[1] ?? '')}</li>`)
      continue
    }
    closeList()
    paragraph.push(line)
  }

  flushParagraph()
  closeList()
  flushQuote()
  if (code) html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  return html.join('\n')
}

function renderInlineMarkdown(value: string): string {
  let result = escapeHtml(value)
  result = result.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) =>
    `<a href="${url}" rel="noreferrer">${label}</a>`
  )
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>')
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  result = result.replace(/_([^_]+)_/g, '<em>$1</em>')
  return result
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}

function openExternalHttps(url: string): void {
  try {
    if (new URL(url).protocol === 'https:') void shell.openExternal(url)
  } catch {
    return
  }
}
