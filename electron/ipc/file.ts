import { dialog, ipcMain, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { resolveSafe } from './vault.js'

export function registerFileIpc() {
  ipcMain.handle('file:read', (_event, relativePath: string) => {
    const fullPath = resolveSafe(relativePath)
    if (!fs.existsSync(fullPath)) return null
    return fs.readFileSync(fullPath, 'utf-8')
  })

  ipcMain.handle('file:write', (_event, relativePath: string, content: string) => {
    const fullPath = resolveSafe(relativePath)
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(fullPath, content, 'utf-8')
  })

  ipcMain.handle('file:delete', (_event, relativePath: string) => {
    const fullPath = resolveSafe(relativePath)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
    }
  })

  ipcMain.handle('file:list', () => {
    const result: { path: string; name: string; content: string }[] = []

    function walk(dir: string, prefix: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          walk(full, rel)
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const content = fs.readFileSync(full, 'utf-8')
          result.push({
            path: rel,
            name: entry.name.replace(/\.md$/i, ''),
            content,
          })
        }
      }
    }

    walk(resolveSafe('.'), '')
    return result
  })

  ipcMain.handle('file:export', async (_event, relativePath: string, content: string) => {
    const fileName = relativePath.split('/').pop() || 'note.md'
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: fileName,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf-8')
    }
  })
}
