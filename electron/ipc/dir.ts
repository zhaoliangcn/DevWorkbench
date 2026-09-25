import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { resolveSafe } from './vault.js'

export function registerDirIpc() {
  ipcMain.handle('dir:list', () => {
    const result: string[] = []

    function walk(dir: string, prefix: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          result.push(rel)
          walk(path.join(dir, entry.name), rel)
        }
      }
    }

    walk(resolveSafe('.'), '')
    return result
  })

  ipcMain.handle('dir:create', (_event, relativePath: string) => {
    const fullPath = resolveSafe(relativePath)
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true })
    }
  })

  ipcMain.handle('dir:delete', (_event, relativePath: string) => {
    const fullPath = resolveSafe(relativePath)
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true })
    }
  })
}
