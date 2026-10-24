import { join } from 'node:path'
import { app } from 'electron'

export function getResourcePath(filename: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, filename)
  }
  return join(app.getAppPath(), 'resources', filename)
}
