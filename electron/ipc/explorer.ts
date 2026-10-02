import { BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// 开发助手：项目文件浏览与编辑（explorer:* 命名空间）
// 路径模型：渲染层传 root（对话框所选项）+ rel（root 内相对路径，'/' 分隔），
// 每次调用经 resolveSafeEx 校验防穿越（无状态，窗口刷新不失效）。
// handler 逻辑抽为独立导出函数（tests/explorer.test.ts 直测）。

const MAX_TEXT_BYTES = 2 * 1024 * 1024 // 文本读取上限 2MB
const MAX_BINARY_BYTES = 20 * 1024 * 1024 // 二进制（图片预览）读取上限 20MB
const SNIFF_BYTES = 8192 // 二进制嗅探读取头部字节数

/** 已知二进制扩展名（含图片；文本分支嗅探兜底用） */
const BINARY_EXTENSIONS = new Set([
  // 图片
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'tif', 'tiff',
  // 归档
  'zip', 'gz', 'tgz', 'tar', 'rar', '7z', 'bz2', 'xz',
  // 媒体
  'mp3', 'mp4', 'avi', 'mkv', 'mov', 'wav', 'flac', 'ogg', 'webm',
  // 可执行/库
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'msi', 'apk', 'node',
  // 文档/字体
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'ttf', 'otf', 'woff', 'woff2',
  // 数据
  'db', 'sqlite', 'sqlite3', 'wasm', 'class', 'pyc', 'o', 'obj', 'lib', 'a',
])

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
}

export interface ExplorerEntry {
  name: string
  /** 相对 root 路径，'/' 分隔；root 自身为 '' */
  relPath: string
  kind: 'file' | 'dir'
  size: number
}

type Err = { success: false; error: string }

function err(e: unknown): Err {
  return { success: false, error: (e as Error).message }
}

/** 路径校验：resolve 后必须等于 root 或位于 root + path.sep 之下（win32 大小写不敏感） */
export function resolveSafeEx(root: string, rel: string): string {
  const absRoot = path.resolve(root)
  const resolved = path.resolve(absRoot, rel || '.')
  const lc = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const nRoot = lc(absRoot)
  const nResolved = lc(resolved)
  if (nResolved !== nRoot && !nResolved.startsWith(nRoot + path.sep)) {
    throw new Error('路径越界')
  }
  return resolved
}

/** 按 NUL 字节嗅探二进制 */
export async function sniffBinary(absPath: string): Promise<boolean> {
  const fh = await fs.open(absPath, 'r')
  try {
    const buf = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await fh.read(buf, 0, SNIFF_BYTES, 0)
    return buf.subarray(0, bytesRead).includes(0)
  } finally {
    await fh.close()
  }
}

/** 顶层巨型依赖目录默认不进树（展开一层即数千节点）；如需放开在渲染层扩展 */
const PRUNED_DIRS = new Set(['node_modules', '.git'])

/** 列出单层目录（目录优先排序，剪枝巨型目录） */
export async function listEntries(root: string, rel: string): Promise<{ success: true; entries: ExplorerEntry[] } | Err> {
  try {
    const abs = resolveSafeEx(root, rel)
    const dirents = await fs.readdir(abs, { withFileTypes: true })
    const entries: ExplorerEntry[] = []
    for (const d of dirents) {
      if (d.isDirectory() && PRUNED_DIRS.has(d.name)) continue
      const childRel = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) {
        entries.push({ name: d.name, relPath: childRel, kind: 'dir', size: 0 })
      } else if (d.isFile()) {
        let size = 0
        try {
          size = (await fs.stat(path.join(abs, d.name))).size
        } catch {
          // stat 失败（如符号链接悬空）时保持 0
        }
        entries.push({ name: d.name, relPath: childRel, kind: 'file', size })
      }
      // 跳过符号链接/block device 等非常规项
    }
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
    return { success: true, entries }
  } catch (e) {
    return err(e)
  }
}

export type ReadResult =
  | { success: true; kind: 'text'; content: string; size: number; mtime: number }
  | { success: true; kind: 'binary'; size: number; mtime: number }
  | { success: true; kind: 'tooLarge'; size: number; mtime: number }
  | Err

/** 读文本文件（带二进制嗅探与大小限制） */
export async function readEntry(root: string, rel: string): Promise<ReadResult> {
  try {
    const abs = resolveSafeEx(root, rel)
    const stat = await fs.stat(abs)
    if (!stat.isFile()) return { success: false, error: '不是普通文件' }
    if (stat.size > MAX_TEXT_BYTES) return { success: true, kind: 'tooLarge', size: stat.size, mtime: stat.mtimeMs }
    const ext = path.extname(abs).slice(1).toLowerCase()
    if (BINARY_EXTENSIONS.has(ext) || (await sniffBinary(abs))) {
      return { success: true, kind: 'binary', size: stat.size, mtime: stat.mtimeMs }
    }
    const content = await fs.readFile(abs, 'utf8')
    return { success: true, kind: 'text', content, size: stat.size, mtime: stat.mtimeMs }
  } catch (e) {
    return err(e)
  }
}

/** 读二进制文件（base64 回传，图片预览用） */
export async function readEntryBinary(root: string, rel: string) {
  try {
    const abs = resolveSafeEx(root, rel)
    const stat = await fs.stat(abs)
    if (!stat.isFile()) return { success: false, error: '不是普通文件' }
    if (stat.size > MAX_BINARY_BYTES) return { success: false, error: '文件超过 20MB 预览上限' }
    const ext = path.extname(abs).slice(1).toLowerCase()
    const mime = IMAGE_MIME[ext] ?? 'application/octet-stream'
    const buf = await fs.readFile(abs)
    return { success: true, mime, base64: buf.toString('base64'), size: stat.size, mtime: stat.mtimeMs }
  } catch (e) {
    return err(e)
  }
}

/** 写文本文件（自动创建父目录） */
export async function writeEntry(root: string, rel: string, content: string) {
  try {
    const abs = resolveSafeEx(root, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
    const stat = await fs.stat(abs)
    return { success: true, size: stat.size, mtime: stat.mtimeMs }
  } catch (e) {
    return err(e)
  }
}

/** 元信息 */
export async function statEntry(root: string, rel: string) {
  try {
    const abs = resolveSafeEx(root, rel)
    const stat = await fs.stat(abs)
    return { success: true, kind: stat.isDirectory() ? ('dir' as const) : ('file' as const), size: stat.size, mtime: stat.mtimeMs }
  } catch (e) {
    return err(e)
  }
}

/** 新建目录（recursive：已存在不报错） */
export async function makeDir(root: string, rel: string) {
  try {
    await fs.mkdir(resolveSafeEx(root, rel), { recursive: true })
    return { success: true }
  } catch (e) {
    return err(e)
  }
}

/** 新建空文件（已存在即失败） */
export async function createEntryFile(root: string, rel: string) {
  let exists = false
  try {
    await fs.access(resolveSafeEx(root, rel))
    exists = true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return err(e)
  }
  if (exists) return { success: false as const, error: '文件已存在' }
  try {
    const abs = resolveSafeEx(root, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, '', 'utf8')
    return { success: true as const }
  } catch (e) {
    return err(e)
  }
}

/** 重命名（限 root 内；目标已存在即失败） */
export async function renameEntry(root: string, rel: string, newName: string) {
  try {
    if (!newName || path.basename(newName) !== newName || newName === '.' || newName === '..') {
      return { success: false, error: '名称非法' }
    }
    const abs = resolveSafeEx(root, rel)
    const dst = path.join(path.dirname(abs), newName)
    const absRoot = path.resolve(root)
    const lc = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
    if (lc(dst) === lc(absRoot) || !lc(dst).startsWith(lc(absRoot + path.sep))) {
      return { success: false, error: '路径越界' }
    }
    try {
      await fs.access(dst)
      return { success: false, error: '同名条目已存在' }
    } catch {
      // 目标不存在才允许重命名
    }
    await fs.rename(abs, dst)
    return { success: true }
  } catch (e) {
    return err(e)
  }
}

/** 删除（目录 recursive；拒绝删除 root 自身） */
export async function deleteEntry(root: string, rel: string) {
  try {
    if (!rel) return { success: false, error: '不能删除项目根目录' }
    await fs.rm(resolveSafeEx(root, rel), { recursive: true, force: false })
    return { success: true }
  } catch (e) {
    return err(e)
  }
}

export function registerExplorerIpc() {
  // 选择项目根目录
  ipcMain.handle('explorer:pickRoot', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: '选择项目根目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true, root: null, name: null }
    }
    const root = result.filePaths[0]
    return { success: true, canceled: false, root, name: path.basename(root) }
  })

  ipcMain.handle('explorer:list', (_e, root: string, rel: string) => listEntries(root, rel))
  ipcMain.handle('explorer:read', (_e, root: string, rel: string) => readEntry(root, rel))
  ipcMain.handle('explorer:readBinary', (_e, root: string, rel: string) => readEntryBinary(root, rel))
  ipcMain.handle('explorer:write', (_e, root: string, rel: string, content: string) => writeEntry(root, rel, content))
  ipcMain.handle('explorer:stat', (_e, root: string, rel: string) => statEntry(root, rel))
  ipcMain.handle('explorer:mkdir', (_e, root: string, rel: string) => makeDir(root, rel))
  ipcMain.handle('explorer:createFile', (_e, root: string, rel: string) => createEntryFile(root, rel))
  ipcMain.handle('explorer:rename', (_e, root: string, rel: string, newName: string) => renameEntry(root, rel, newName))
  ipcMain.handle('explorer:delete', (_e, root: string, rel: string) => deleteEntry(root, rel))
}
