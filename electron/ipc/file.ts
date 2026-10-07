import { dialog, ipcMain, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { resolveSafe, markWrite } from './vault.js'

const MAX_IMPORT_BYTES = 5 * 1024 * 1024

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

  // 另存为：渲染进程只给默认文件名与过滤器，路径由系统对话框决定
  ipcMain.handle(
    'file:saveTextAs',
    async (_event, fileName: string, content: string, filterName?: string, extension?: string) => {
      if (typeof content !== 'string') return { success: false, canceled: true }
      const mainWindow = BrowserWindow.getAllWindows()[0]
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: typeof fileName === 'string' && fileName ? fileName : 'export.txt',
        filters: [{ name: filterName || '文本文件', extensions: [extension || 'txt'] }],
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      try {
        fs.writeFileSync(result.filePath, content, 'utf-8')
        return { success: true, canceled: false, path: result.filePath }
      } catch (e) {
        return { success: false, canceled: false, error: (e as Error).message }
      }
    },
  )

  // 打开并读取：单次 IPC 完成对话框选择+读取，渲染进程无法指定任意路径
  ipcMain.handle('file:openTextFile', async (_event, filterName?: string, extensions?: string[]) => {
    const exts =
      Array.isArray(extensions) && extensions.length
        ? extensions.slice(0, 8).map(String).filter((e) => /^[A-Za-z0-9]{1,8}$/.test(e))
        : ['txt']
    const result = await dialog.showOpenDialog({
      title: '打开文件',
      properties: ['openFile'],
      filters: [{ name: filterName || '文本文件', extensions: exts.length ? exts : ['txt'] }],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true, content: '' }
    }
    const filePath = result.filePaths[0]
    try {
      const stat = fs.statSync(filePath)
      if (stat.size > MAX_IMPORT_BYTES) {
        return { success: false, canceled: false, content: '', error: '文件超过 5MB 上限' }
      }
      return { success: true, canceled: false, content: fs.readFileSync(filePath, 'utf-8'), path: filePath }
    } catch (e) {
      return { success: false, canceled: false, content: '', error: (e as Error).message }
    }
  })
}
