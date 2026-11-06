import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

// 工具箱：文件解压 IO 壳（archive:*）
// 格式识别 / 条目列表 / 路径净化 / 同名规划 / 解压引擎唯一实现位于渲染层
// src/workspaces/toolbox/tools/pure/archive.ts（electron tsconfig rootDir 限制无法跨包 import）。
// 本文件只负责会话绑定的文件选择、字节读取与分批落盘，并对写入路径做二次校验。

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024 // 压缩包读取上限（防渲染层内存失控）
const MAX_BATCH_ITEMS = 5000 // 单批最多文件数
const MAX_BATCH_BASE64 = 64 * 1024 * 1024 // 单批 base64 字符上限
const MAX_ERRORS = 50

/** 会话绑定：只接受 archive:pick / pickTarget 最近返回的路径（防任意路径读写） */
let sessionArchive: string | null = null
let sessionTarget: string | null = null

type ConflictPolicy = 'overwrite' | 'skip' | 'rename'

interface WriteItem {
  path: string
  kind: 'file' | 'dir'
  base64?: string
}

interface ArchiveOp {
  id: string
  targetDir: string
  conflict: ConflictPolicy
  createdFiles: string[]
  createdDirs: string[]
  written: number
  overwritten: number
  skipped: number
  renamed: number
  dirs: number
  writtenBytes: number
  errors: string[]
  canceled: boolean
}

let currentOp: ArchiveOp | null = null

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return true
  }
  return false
}

function isPathInside(root: string, candidate: string): boolean {
  const lc = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const r = lc(path.resolve(root))
  const c = lc(path.resolve(candidate))
  return c === r || c.startsWith(r + path.sep)
}

/** 主进程二次校验：渲染层已净化，但落盘前仍拒绝绝对路径/.. /非法字符 */
function splitSafeRelative(raw: unknown): string[] {
  const value = String(raw ?? '').replace(/\\/g, '/')
  if (!value || value.startsWith('/') || /^[a-zA-Z]:/.test(value) || value.startsWith('//')) {
    throw new Error('非法解压路径：绝对路径')
  }
  const segments = value.split('/')
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || hasControlChar(seg)) {
      throw new Error('非法解压路径')
    }
    if (/[:*?"<>|]/.test(seg)) throw new Error('非法解压路径：包含非法字符')
  }
  return segments
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

/** 逐级创建目录并记录本次新建的目录，取消/失败时可回收空目录 */
async function ensureDirs(root: string, dir: string, op: ArchiveOp): Promise<void> {
  const rel = path.relative(root, dir)
  if (!rel) return
  let current = root
  for (const seg of rel.split(path.sep)) {
    current = path.join(current, seg)
    if (!(await pathExists(current))) {
      try {
        await fsp.mkdir(current, { recursive: false })
        op.createdDirs.push(current)
      } catch (error) {
        // 并发下可能已被创建，忽略 EEXIST
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
  }
}

async function uniqueFsPath(target: string): Promise<string> {
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const stem = path.basename(target, ext)
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${stem} (${i})${ext}`)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new Error('同名文件过多，无法自动重命名')
}

function pushError(op: ArchiveOp, message: string): void {
  if (op.errors.length < MAX_ERRORS) op.errors.push(message)
}

/** 清理本次操作新建的文件与空目录；已覆盖的旧文件无法恢复，单独计数返回 */
async function cleanupOp(op: ArchiveOp): Promise<number> {
  let cleaned = 0
  for (const file of [...op.createdFiles].reverse()) {
    try {
      await fsp.unlink(file)
      cleaned++
    } catch {
      // 已被移动/删除的文件忽略
    }
  }
  for (const dir of [...op.createdDirs].reverse()) {
    try {
      await fsp.rmdir(dir)
      cleaned++
    } catch {
      // 非空或已删除的目录忽略
    }
  }
  return cleaned
}

function getOp(opId: unknown): ArchiveOp {
  if (!currentOp || currentOp.id !== opId) throw new Error('解压会话已失效，请重新开始')
  return currentOp
}

export function registerArchiveIpc(): void {
  // 选择压缩包（rar/7z 也允许选中，由渲染层给出明确的不支持提示）
  ipcMain.handle('archive:pick', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: '压缩包', extensions: ['zip', 'jar', 'war', 'tar', 'gz', 'tgz', 'rar', '7z'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return { canceled: true }
    const abs = path.resolve(picked)
    const stat = fs.statSync(abs)
    if (!stat.isFile()) throw new Error('请选择压缩文件')
    sessionArchive = abs
    sessionTarget = null
    return { canceled: false, path: abs, name: path.basename(abs), size: stat.size }
  })

  // 选择解压输出目录（默认落在压缩包同级目录）
  ipcMain.handle('archive:pickTarget', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: sessionArchive ? path.dirname(sessionArchive) : undefined,
    })
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return { canceled: true }
    const abs = path.resolve(picked)
    sessionTarget = abs
    return { canceled: false, path: abs, name: path.basename(abs) }
  })

  // 渲染层引擎用：读取会话内压缩包字节
  ipcMain.handle('archive:readBytes', async () => {
    if (!sessionArchive) throw new Error('请先选择压缩包')
    const stat = fs.statSync(sessionArchive)
    if (!stat.isFile()) throw new Error('压缩包不存在')
    if (stat.size > MAX_ARCHIVE_BYTES) {
      throw new Error(`压缩包超过 ${MAX_ARCHIVE_BYTES / 1024 / 1024}MB 上限，暂不支持解压`)
    }
    return {
      base64: fs.readFileSync(sessionArchive).toString('base64'),
      size: stat.size,
      name: path.basename(sessionArchive),
    }
  })

  // 开始一次写入会话：输出目录必须来自 pickTarget
  ipcMain.handle('archive:writeStart', async (_event, args: { conflict?: ConflictPolicy }) => {
    if (!sessionTarget) throw new Error('请先选择解压输出目录')
    if (currentOp) throw new Error('已有解压任务进行中')
    const conflict = args?.conflict ?? 'rename'
    if (!['overwrite', 'skip', 'rename'].includes(conflict)) throw new Error('无效的同名处理策略')
    currentOp = {
      id: crypto.randomUUID(),
      targetDir: sessionTarget,
      conflict,
      createdFiles: [],
      createdDirs: [],
      written: 0,
      overwritten: 0,
      skipped: 0,
      renamed: 0,
      dirs: 0,
      writtenBytes: 0,
      errors: [],
      canceled: false,
    }
    return { opId: currentOp.id }
  })

  // 分批落盘：逐条校验路径、处理同名、临时文件原子替换
  ipcMain.handle('archive:writeBatch', async (_event, args: { opId: string; items: WriteItem[] }) => {
    const op = getOp(args?.opId)
    const items = Array.isArray(args?.items) ? args.items : []
    if (items.length > MAX_BATCH_ITEMS) throw new Error('单批文件数量过多')
    let base64Chars = 0
    for (const item of items) base64Chars += String(item?.base64 ?? '').length
    if (base64Chars > MAX_BATCH_BASE64) throw new Error('单批数据量过大')

    const batch = { written: 0, skipped: 0, renamed: 0, overwritten: 0, dirs: 0, canceled: false }
    for (const item of items) {
      if (op.canceled) {
        batch.canceled = true
        break
      }
      try {
        const segments = splitSafeRelative(item?.path)
        const abs = path.resolve(op.targetDir, ...segments)
        if (!isPathInside(op.targetDir, abs)) throw new Error('解压路径越界')

        if (item.kind === 'dir') {
          await ensureDirs(op.targetDir, abs, op)
          op.dirs++
          batch.dirs++
          continue
        }
        if (item.kind !== 'file') throw new Error('未知条目类型')

        const buf = Buffer.from(String(item.base64 ?? ''), 'base64')
        await ensureDirs(op.targetDir, path.dirname(abs), op)

        let finalPath = abs
        const existed = await pathExists(abs)
        if (existed) {
          if (op.conflict === 'skip') {
            op.skipped++
            batch.skipped++
            continue
          }
          if (op.conflict === 'rename') {
            finalPath = await uniqueFsPath(abs)
            // 重命名后的目标是本次新建文件，取消/异常时需一并回收
            op.createdFiles.push(finalPath)
            op.renamed++
            batch.renamed++
          } else {
            op.overwritten++
            batch.overwritten++
          }
        } else {
          op.createdFiles.push(abs)
        }

        // 先写临时文件再改名，避免中断留下半截文件
        const tmp = `${finalPath}.dwtmp-${crypto.randomUUID()}`
        try {
          await fsp.writeFile(tmp, buf)
          await fsp.rename(tmp, finalPath)
        } catch (error) {
          await fsp.unlink(tmp).catch(() => undefined)
          throw error
        }
        op.written++
        op.writtenBytes += buf.length
        batch.written++
      } catch (error) {
        pushError(op, `${item?.path ?? '?'}：${(error as Error).message}`)
      }
    }
    if (op.canceled) batch.canceled = true
    return batch
  })

  // 结束会话：取消/异常时回收新建文件与空目录
  ipcMain.handle('archive:finish', async (_event, args: { opId: string; abort?: boolean }) => {
    const op = getOp(args?.opId)
    const cleaned = args?.abort ? await cleanupOp(op) : 0
    currentOp = null
    return {
      written: op.written,
      overwritten: op.overwritten,
      skipped: op.skipped,
      renamed: op.renamed,
      dirs: op.dirs,
      writtenBytes: op.writtenBytes,
      errors: op.errors,
      errorCount: op.errors.length,
      cleaned,
      canceled: op.canceled || Boolean(args?.abort),
    }
  })

  // 取消标记：writeBatch 在文件之间检查，渲染层随后以 abort 结束会话触发清理
  ipcMain.handle('archive:cancel', async () => {
    if (!currentOp) return false
    currentOp.canceled = true
    return true
  })
}
