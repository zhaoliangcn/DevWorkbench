import { dialog, ipcMain, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { resolveSafe, markWrite } from './vault.js'

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
    markWrite(relativePath) // 防回环：自己的写不打回 vault:changed
  })

  ipcMain.handle('file:delete', (_event, relativePath: string) => {
    const fullPath = resolveSafe(relativePath)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
      markWrite(relativePath)
    }
  })

  // 二进制通道（附录 E E.3.5 附件）：base64 传输，路径校验复用 resolveSafe 防穿越
  ipcMain.handle('file:writeBinary', (_event, relativePath: string, base64: string) => {
    const fullPath = resolveSafe(relativePath)
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(fullPath, Buffer.from(base64, 'base64'))
    markWrite(relativePath)
  })

  ipcMain.handle('file:readBinary', (_event, relativePath: string) => {
    const fullPath = resolveSafe(relativePath)
    if (!fs.existsSync(fullPath)) return null
    return fs.readFileSync(fullPath).toString('base64')
  })

  ipcMain.handle('file:list', () => {
    const result: { path: string; name: string; content: string }[] = []

    function walk(dir: string, prefix: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        // 保留目录不进笔记树：trash/ 回收站、attachments/ 二进制附件（templates/ 由渲染层分类）
        if (entry.isDirectory()) {
          if (entry.name === 'trash' || entry.name === 'attachments') continue
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

  /* ---------- 回收站（附录 E E.3.6）：deleteNote 移入 trash/ 替代直删 ---------- */

  ipcMain.handle('trash:list', () => {
    const trashDir = resolveSafe('trash')
    const result: { relPath: string; name: string; mtime: number }[] = []
    if (!fs.existsSync(trashDir)) return result

    function walk(dir: string, prefix: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          walk(full, rel)
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          result.push({
            relPath: `trash/${rel}`,
            name: entry.name.replace(/\.md$/i, ''),
            mtime: fs.statSync(full).mtimeMs,
          })
        }
      }
    }

    walk(trashDir, '')
    return result.sort((a, b) => b.mtime - a.mtime)
  })

  ipcMain.handle('trash:restore', (_event, relPath: string) => {
    // relPath 必须在 trash/ 内；恢复到剥离前缀后的原路径（重名自动加后缀）
    if (!relPath.startsWith('trash/')) throw new Error('仅支持恢复回收站内文件')
    const fromPath = resolveSafe(relPath)
    if (!fs.existsSync(fromPath)) throw new Error('文件不存在')

    let target = relPath.slice('trash/'.length)
    const targetFull0 = resolveSafe(target)
    if (fs.existsSync(targetFull0)) {
      const dir = path.posix.dirname(target)
      const ext = path.posix.extname(target)
      const base = path.posix.basename(target, ext)
      let counter = 1
      while (fs.existsSync(resolveSafe(path.posix.join(dir, `${base} (${counter})${ext}`)))) counter++
      target = path.posix.join(dir === '.' ? '' : dir, `${base} (${counter})${ext}`)
    }

    const targetFull = resolveSafe(target)
    const targetDir = path.dirname(targetFull)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }
    fs.renameSync(fromPath, targetFull)
    // 移入与移出都要打标：防止 unlink+add 两条回声事件
    markWrite(relPath)
    markWrite(target)
    return { path: target }
  })

  ipcMain.handle('trash:purge', (_event, relPath: string) => {
    if (!relPath.startsWith('trash/')) throw new Error('仅支持清空回收站内文件')
    const fullPath = resolveSafe(relPath)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
      markWrite(relPath)
    }
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
