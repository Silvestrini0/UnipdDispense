import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { load as loadYaml } from 'js-yaml'
import { logger } from './logger'

const GITHUB_RELEASE_API = 'https://api.github.com/repos/Silvestrini0/UnipdDispense/releases/latest'
const UPDATE_CHECK_TIMEOUT_MS = 30_000
const UPDATE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000

export interface MacUpdatePackage {
  version: string
  url: string
  filename: string
  sha512: string
  size: number
}

interface PendingMacUpdate extends MacUpdatePackage {
  archivePath: string
}

interface GitHubRelease {
  tag_name?: unknown
  assets?: unknown
}

interface GitHubAsset {
  name?: unknown
  browser_download_url?: unknown
}

interface UpdateManifest {
  version?: unknown
  files?: unknown
}

interface ManifestFile {
  url?: unknown
  sha512?: unknown
  size?: unknown
}

export async function findMacUpdate(currentVersion: string): Promise<MacUpdatePackage | null> {
  const release = await requestJson<GitHubRelease>(GITHUB_RELEASE_API)
  const version = releaseVersion(release.tag_name)
  if (!version || compareVersions(version, currentVersion) <= 0) {
    return null
  }

  const assets = asArray<GitHubAsset>(release.assets)
  const manifestAsset = assets.find((asset) => asset.name === 'latest-mac.yml')
  if (
    !manifestAsset ||
    typeof manifestAsset.browser_download_url !== 'string' ||
    !isGitHubAssetUrl(manifestAsset.browser_download_url)
  ) {
    throw new Error('La release non contiene il manifest per gli aggiornamenti Mac.')
  }

  const manifestText = await requestText(manifestAsset.browser_download_url)
  const manifest = loadYaml(manifestText) as UpdateManifest | null
  if (!manifest || releaseVersion(manifest.version) !== version || !Array.isArray(manifest.files)) {
    throw new Error('Il manifest della release Mac non è valido.')
  }

  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
  const expectedFilename = `UnipdDispense-macOS-${version}-${architecture}.zip`
  const file = (manifest.files as ManifestFile[]).find(
    (candidate) =>
      candidate.url === expectedFilename &&
      typeof candidate.sha512 === 'string' &&
      /^[A-Za-z0-9+/]{86}==$/.test(candidate.sha512) &&
      typeof candidate.size === 'number' &&
      Number.isSafeInteger(candidate.size) &&
      candidate.size > 0
  )
  if (!file || typeof file.url !== 'string' || typeof file.sha512 !== 'string' || typeof file.size !== 'number') {
    throw new Error(`La release non contiene il pacchetto Mac ${architecture}.`)
  }

  const asset = assets.find((candidate) => candidate.name === file.url)
  if (!asset || typeof asset.browser_download_url !== 'string' || !isGitHubAssetUrl(asset.browser_download_url)) {
    throw new Error('Il pacchetto Mac indicato dal manifest non è presente nella release.')
  }

  return {
    version,
    url: asset.browser_download_url,
    filename: file.url,
    sha512: file.sha512,
    size: file.size
  }
}

export async function downloadMacUpdate(
  update: MacUpdatePackage,
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<PendingMacUpdate> {
  const updatesDirectory = join(app.getPath('userData'), 'updates')
  await mkdir(updatesDirectory, { recursive: true })
  const archivePath = join(updatesDirectory, update.filename)
  await rm(archivePath, { force: true })

  const response = await fetch(update.url, {
    redirect: 'follow',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(UPDATE_DOWNLOAD_TIMEOUT_MS)])
      : AbortSignal.timeout(UPDATE_DOWNLOAD_TIMEOUT_MS),
    headers: { 'User-Agent': 'UnipdDispense' }
  })
  if (!response.ok || !response.body) {
    throw new Error(`Download aggiornamento non riuscito (HTTP ${response.status}).`)
  }

  const hash = createHash('sha512')
  let transferred = 0
  const pendingPath = join(updatesDirectory, 'pending-mac.json')
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      transferred += chunk.length
      hash.update(chunk)
      onProgress(Math.min(99, (transferred / update.size) * 100))
      callback(null, chunk)
    }
  })

  try {
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      progress,
      createWriteStream(archivePath, { flags: 'wx', mode: 0o600 })
    )
    signal?.throwIfAborted()
    const digest = hash.digest('base64')
    if (transferred !== update.size || digest !== update.sha512) {
      throw new Error('Il pacchetto scaricato non supera la verifica di integrità.')
    }
    onProgress(100)
    signal?.throwIfAborted()
    const pending: PendingMacUpdate = { ...update, archivePath }
    await writeFile(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    signal?.throwIfAborted()
    return pending
  } catch (error) {
    await Promise.all([
      rm(archivePath, { force: true }),
      rm(pendingPath, { force: true })
    ])
    throw error
  }
}

export async function loadPendingMacUpdate(currentVersion: string): Promise<PendingMacUpdate | null> {
  const updatesDirectory = join(app.getPath('userData'), 'updates')
  const manifestPath = join(updatesDirectory, 'pending-mac.json')
  try {
    const pending = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<PendingMacUpdate>
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
    if (typeof pending.version !== 'string' || !releaseVersion(pending.version)) {
      throw new Error('Manifest locale aggiornamento Mac non valido.')
    }
    const expectedFilename = `UnipdDispense-macOS-${pending.version}-${architecture}.zip`
    if (
      pending.filename !== expectedFilename ||
      typeof pending.sha512 !== 'string' ||
      !/^[A-Za-z0-9+/]{86}==$/.test(pending.sha512) ||
      typeof pending.size !== 'number' ||
      !Number.isSafeInteger(pending.size) ||
      pending.size <= 0 ||
      typeof pending.url !== 'string' ||
      !isGitHubAssetUrl(pending.url)
    ) {
      throw new Error('Manifest locale aggiornamento Mac non valido.')
    }

    const archivePath = join(updatesDirectory, pending.filename)
    if (compareVersions(currentVersion, pending.version) >= 0) {
      await clearPendingMacUpdate(updatesDirectory, archivePath)
      await cleanupMacBackups(updatesDirectory, currentVersion)
      return null
    }

    const hash = createHash('sha512')
    let size = 0
    for await (const chunk of createReadStream(archivePath)) {
      size += chunk.length
      hash.update(chunk)
    }
    if (size !== pending.size || hash.digest('base64') !== pending.sha512) {
      throw new Error('Il pacchetto Mac salvato non supera la verifica di integrità.')
    }
    return {
      version: pending.version,
      filename: pending.filename,
      url: pending.url,
      sha512: pending.sha512,
      size: pending.size,
      archivePath
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    logger.warn('Ripristino aggiornamento Mac in sospeso non riuscito:', error)
    await clearPendingMacUpdate(updatesDirectory)
    return null
  }
}

export async function installMacUpdate(archivePath: string, version: string): Promise<void> {
  const updatesDirectory = join(app.getPath('userData'), 'updates')
  const extractionDirectory = await mkdtemp(join(tmpdir(), 'unipddispense-update-'))
  await run('/usr/bin/ditto', ['-x', '-k', archivePath, extractionDirectory])

  const currentBundle = appBundlePath(process.execPath)
  const stagedBundle = await findAppBundle(extractionDirectory)
  if (!currentBundle || !stagedBundle || stagedBundle.name !== currentBundle.name) {
    await rm(extractionDirectory, { recursive: true, force: true })
    throw new Error('Impossibile individuare il bundle Mac da aggiornare.')
  }

  const backupBundle = join(updatesDirectory, `previous-${app.getVersion()}-before-${version}.app`)
  const installerScript = join(extractionDirectory, 'install-update.sh')
  const script = [
    '#!/bin/sh',
    'set -eu',
    `parent_pid=${shellQuote(String(process.pid))}`,
    `current_bundle=${shellQuote(currentBundle.path)}`,
    `staged_bundle=${shellQuote(stagedBundle.path)}`,
    `backup_bundle=${shellQuote(backupBundle)}`,
    `extraction_directory=${shellQuote(extractionDirectory)}`,
    'while /bin/kill -0 "$parent_pid" 2>/dev/null; do /bin/sleep 0.25; done',
    '/usr/bin/ditto "$current_bundle" "$backup_bundle"',
    '/bin/rm -rf "$current_bundle"',
    'if ! /usr/bin/ditto "$staged_bundle" "$current_bundle"; then',
    '  /usr/bin/ditto "$backup_bundle" "$current_bundle"',
    '  exit 1',
    'fi',
    'if [ "$(/usr/bin/id -u)" -eq 0 ]; then',
    '  console_uid=$(/usr/bin/stat -f %u /dev/console)',
    '  /usr/bin/sudo -u "#$console_uid" -H /usr/bin/open -a "$current_bundle"',
    'else',
    '  /usr/bin/open -a "$current_bundle"',
    'fi',
    '/bin/rm -rf "$extraction_directory"'
  ].join('\n')
  await writeFile(installerScript, `${script}\n`, { encoding: 'utf8', mode: 0o700 })

  let elevated = false
  try {
    await access(dirname(currentBundle.path), constants.W_OK)
  } catch {
    elevated = true
  }

  if (elevated) {
    const command = `/bin/sh ${shellQuote(installerScript)}`
    const appleScript = `do shell script "${escapeAppleScript(command)}" with administrator privileges`
    await spawnDetached('/usr/bin/osascript', ['-e', appleScript])
  } else {
    await spawnDetached('/bin/sh', [installerScript])
  }
  app.quit()
}

export async function openMacSecuritySettings(): Promise<void> {
  try {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Security'
    )
  } catch {
    await run('/usr/bin/open', ['-a', 'System Settings'])
  }
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'UnipdDispense'
    }
  })
  if (!response.ok) {
    throw new Error(`Controllo aggiornamenti non riuscito (HTTP ${response.status}).`)
  }
  return (await response.json()) as T
}

async function requestText(url: string): Promise<string> {
  if (!isGitHubAssetUrl(url)) {
    throw new Error('Il manifest aggiornamenti non proviene da GitHub.')
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    headers: { 'User-Agent': 'UnipdDispense' }
  })
  if (!response.ok) {
    throw new Error(`Lettura manifest aggiornamenti non riuscita (HTTP ${response.status}).`)
  }
  return response.text()
}

function releaseVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const version = value.replace(/^v/, '')
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? version : null
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(/[.+-]/).slice(0, 3).map(Number)
  const rightParts = right.split(/[.+-]/).slice(0, 3).map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function isGitHubAssetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com'
  } catch {
    return false
  }
}

function appBundlePath(executablePath: string): { name: string; path: string } | null {
  let candidate = resolve(executablePath)
  while (candidate !== dirname(candidate)) {
    if (candidate.endsWith('.app')) {
      return { name: candidate.split('/').at(-1) ?? '', path: candidate }
    }
    candidate = dirname(candidate)
  }
  return null
}

async function findAppBundle(root: string): Promise<{ name: string; path: string } | null> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = join(root, entry.name)
    if (entry.isDirectory() && entry.name.endsWith('.app')) {
      return { name: entry.name, path: candidate }
    }
    if (entry.isDirectory()) {
      const nested = await findAppBundle(candidate)
      if (nested) return nested
    }
  }
  return null
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('error', rejectPromise)
    child.once('spawn', () => {
      child.unref()
      resolvePromise()
    })
  })
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`${command} non è riuscito (codice ${code ?? 'sconosciuto'}).`))
    })
  })
}

async function clearPendingMacUpdate(updatesDirectory: string, archivePath?: string): Promise<void> {
  await rm(join(updatesDirectory, 'pending-mac.json'), { force: true })
  if (archivePath) await rm(archivePath, { force: true })
}

async function cleanupMacBackups(updatesDirectory: string, currentVersion: string): Promise<void> {
  try {
    for (const name of await readdir(updatesDirectory)) {
      const match = /^previous-(\d+\.\d+\.\d+)-before-(\d+\.\d+\.\d+)\.app$/.exec(name)
      if (match?.[1] && compareVersions(currentVersion, match[1]) > 0) {
        await rm(join(updatesDirectory, name), { recursive: true, force: true })
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Pulizia copia di sicurezza aggiornamento Mac non riuscita:', error)
    }
  }
}
