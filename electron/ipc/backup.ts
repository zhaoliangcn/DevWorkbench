// 工具箱：文件夹备份（backup:* 命名空间）。
// 对齐 smb.ts 惯例：纯逻辑（通配符匹配/名称校验/默认命名/清单清洗/遍历复制）导出供 tests/backup.test.ts 直测。
// 路径安全（对齐 iconconvert 会话绑定）：源/目标目录必须来自本会话 pickSource/pickTarget 返回值，
// 防渲染层被注入后任意路径读写；备份名拒绝路径分隔符与 Windows 保留字符；落盘前校验 dest 不越出 targetDir。
// 不阻塞主进程：fs.promises 异步遍历 + 逐文件 copyFile，progress 节流推送；支持中途取消。
// 符号链接一律跳过（防环）；覆盖模式为合并写入（同名文件覆盖，多余旧文件保留）。
import { dialog, ipcMain, BrowserWindow } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import zlib from 'node:zlib'

/* ---------- 纯逻辑（可单测） ---------- */

/** 排除规则：files/dirs 为精确名，patterns 为通配符（* 段内、** 跨段、? 单字符） */
export interface BackupExcludes {
  files: string[]
  dirs: string[]
  patterns: string[]
}

/** 渲染层传入的未知数据 → 安全的排除清单（逐条 trim、截断超长/超量输入） */
export function sanitizeExcludes(input: unknown): BackupExcludes {
  const pick = (v: unknown): string[] => {
    if (!Array.isArray(v)) return []
    return v
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((s) => s.slice(0, 200))
  }
  const obj = (input ?? {}) as Record<string, unknown>
  return { files: pick(obj.files), dirs: pick(obj.dirs), patterns: pick(obj.patterns) }
}

/** 需要转义的正则元字符（避开复杂字符类字面量，oxc 转换更稳） */
const REGEX_SPECIAL = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])

// 通配符 → 全匹配正则（大小写不敏感；输入兼容 Windows 反斜杠并剥掉首部斜杠）：
// 星号匹配段内任意字符；双星跨目录段（其后紧跟斜杠时匹配零个或多个目录前缀）；问号匹配单个字符。
export function wildcardToRegExp(pattern: string): RegExp | null {
  const p = pattern.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p) return null
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]
    if (ch === '*') {
      if (p[i + 1] === '*') {
        if (p[i + 2] === '/') {
          re += '(?:[^/]+/)*'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else {
      if (REGEX_SPECIAL.has(ch)) re += '\\'
      re += ch
    }
  }
  try {
    return new RegExp(`^${re}$`, 'i')
  } catch {
    return null
  }
}

export interface BackupMatcher {
  /** relPath 以 '/' 分隔；kind 决定精确名单适用范围（文件/目录各自生效，通配符均生效） */
  isExcluded(relPath: string, kind: 'file' | 'dir'): boolean
}

/** 构建排除匹配器：精确名按 basename 或相对路径（含 / 时）匹配，大小写不敏感 */
export function createBackupMatcher(excludes: BackupExcludes): BackupMatcher {
  const fileBase = new Set<string>()
  const fileRel = new Set<string>()
  const dirBase = new Set<string>()
  const dirRel = new Set<string>()
  const put = (base: Set<string>, rel: Set<string>, raw: string) => {
    const v = raw.trim().toLowerCase().replace(/\\/g, '/')
    if (!v) return
    if (v.includes('/')) rel.add(v.replace(/^\/+/, ''))
    else base.add(v)
  }
  for (const s of excludes.files) put(fileBase, fileRel, s)
  for (const s of excludes.dirs) put(dirBase, dirRel, s)
  const rules = excludes.patterns
    .map((raw) => {
      const norm = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '')
      const re = wildcardToRegExp(norm)
      return re ? { re, hasSlash: norm.includes('/') } : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  return {
    isExcluded(relPath, kind) {
      const norm = relPath.replace(/\\/g, '/').toLowerCase()
      const base = norm.slice(norm.lastIndexOf('/') + 1)
      if (kind === 'dir') {
        if (dirBase.has(base) || dirRel.has(norm)) return true
      } else if (fileBase.has(base) || fileRel.has(norm)) return true
      for (const r of rules) {
        if (r.hasSlash ? r.re.test(norm) : r.re.test(base)) return true
      }
      return false
    },
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** 备份名校验：非空、无路径分隔符/Windows 非法字符、不以点/空格结尾、非保留设备名 */
export function validateBackupName(name: string): string | null {
  const v = name.trim()
  if (!v) return '备份名称不能为空'
  if (v.startsWith('.')) return '备份名称不能以点号开头'
  if (/[\\/:*?"<>|]/.test(v)) return '备份名称不能包含 \\ / : * ? " < > | 字符'
  if (/[. ]$/.test(v)) return '备份名称不能以点号或空格结尾'
  if (v.length > 100) return '备份名称过长（最多 100 字符）'
  if (WINDOWS_RESERVED.test(v)) return '备份名称为 Windows 保留设备名'
  return null
}

/** 默认备份名：源目录名（非法字符替换为 _）+ backup + 时间戳 */
export function defaultBackupName(sourceName: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const base = (sourceName || 'backup').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60) || 'backup'
  return `${base}-backup-${ts}`
}

/* ---------- 遍历与复制（导出供测试） ---------- */

export interface ScanEntry {
  abs: string
  rel: string
  size: number
}

export interface ScanResult {
  files: ScanEntry[]
  skippedFiles: number
  skippedDirs: number
  skippedSymlinks: number
  errors: string[]
}

const MAX_ERRORS = 50

/** 递归遍历源目录（排除剪枝；符号链接跳过防环），产出待复制文件清单 */
export async function walkSource(
  root: string,
  matcher: BackupMatcher,
  onFile?: (rel: string) => void,
): Promise<ScanResult> {
  const result: ScanResult = { files: [], skippedFiles: 0, skippedDirs: 0, skippedSymlinks: 0, errors: [] }
  async function walk(dir: string, relDir: string): Promise<void> {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch (err) {
      if (result.errors.length < MAX_ERRORS)
        result.errors.push(`读取目录失败 ${relDir || '.'}: ${(err as Error).message}`)
      return
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        result.skippedSymlinks++
        continue
      }
      if (entry.isDirectory()) {
        if (matcher.isExcluded(rel, 'dir')) {
          result.skippedDirs++
          continue
        }
        await walk(path.join(dir, entry.name), rel)
      } else if (entry.isFile()) {
        if (matcher.isExcluded(rel, 'file')) {
          result.skippedFiles++
          continue
        }
        try {
          const abs = path.join(dir, entry.name)
          const stat = await fsp.stat(abs)
          result.files.push({ abs, rel, size: stat.size })
          onFile?.(rel)
        } catch (err) {
          if (result.errors.length < MAX_ERRORS)
            result.errors.push(`读取文件失败 ${rel}: ${(err as Error).message}`)
        }
      }
    }
  }
  await walk(root, '')
  return result
}

export interface CopyOutcome {
  copied: number
  copiedBytes: number
  /** 成功复制的相对路径清单（zip 打包按此清单取文件） */
  copiedRels: string[]
  errors: string[]
  canceled: boolean
}

/** 逐文件复制（复制前确保子目录存在；isCancelled 返回 true 时中止） */
export async function copyFiles(
  files: ScanEntry[],
  destRoot: string,
  onProgress: (copied: number) => void,
  isCancelled: () => boolean,
): Promise<CopyOutcome> {
  const outcome: CopyOutcome = { copied: 0, copiedBytes: 0, copiedRels: [], errors: [], canceled: false }
  for (const f of files) {
    if (isCancelled()) {
      outcome.canceled = true
      break
    }
    const target = path.join(destRoot, ...f.rel.split('/'))
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.copyFile(f.abs, target)
      outcome.copied++
      outcome.copiedBytes += f.size
      outcome.copiedRels.push(f.rel)
    } catch (err) {
      if (outcome.errors.length < MAX_ERRORS)
        outcome.errors.push(`复制失败 ${f.rel}: ${(err as Error).message}`)
    }
    onProgress(outcome.copied)
  }
  return outcome
}

/* ---------- zip 打包（零新增依赖：DEFLATE 复用 node:zlib，容器纯 JS，对齐 icon-convert 惯例） ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? ((0xedb88320 ^ (c >>> 1)) >>> 0) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** CRC-32（IEEE 802.3，zip 标准校验算法） */
export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 流式计算文件 CRC-32（1MB 分块，避免大文件整读内存） */
function crc32File(abs: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let c = 0xffffffff
    const stream = fs.createReadStream(abs, { highWaterMark: 1 << 20 })
    stream.on('data', (chunk: string | Buffer) => {
      // 未指定编码，运行时恒为 Buffer
      const data = chunk as Buffer
      for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
    })
    stream.on('end', () => resolve((c ^ 0xffffffff) >>> 0))
    stream.on('error', reject)
  })
}

/** zip 使用的 DOS 日期时间编码 */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export interface ZipEntry {
  /** zip 内相对路径，'/' 分隔 */
  name: string
  /** 磁盘绝对路径 */
  abs: string
  /** 文件字节数（进度总量用；写入时以重新 stat 为准） */
  size: number
}

// 超阈值的单个大文件走 STORE 流式（deflateRawSync 会产生原文件大小的内存尖峰）
export const ZIP_STORE_THRESHOLD = 256 * 1024 * 1024
// 经典 zip 格式上限（未实现 zip64，超限直接拒绝并保留文件夹备份）
const ZIP_MAX_BYTES = 4 * 1024 * 1024 * 1024 - 1
const ZIP_MAX_ENTRIES = 65000

export type ZipResult = { canceled: true } | { canceled: false; files: number; bytes: number }

/**
 * 将文件清单打包为 zip（DEFLATE level 6，小文件压缩无收益时自动 STORE；文件名 UTF-8 标志位）。
 * 超阈值大文件走 STORE 两遍流式（先算 CRC 再拷贝），内存有界；取消时返回 canceled，由调用方清理半成品。
 */
export async function writeZip(
  outPath: string,
  entries: ZipEntry[],
  onProgress: (doneBytes: number, totalBytes: number, current: string) => void,
  isCancelled: () => boolean,
  storeThreshold = ZIP_STORE_THRESHOLD,
): Promise<ZipResult> {
  const totalBytes = entries.reduce((s, e) => s + e.size, 0)
  if (totalBytes > ZIP_MAX_BYTES || entries.length > ZIP_MAX_ENTRIES) {
    throw new Error('备份内容超出 zip 格式上限（4GB 或 65000 文件），请取消勾选压缩为 zip')
  }
  const out = fs.createWriteStream(outPath)
  // 真实错误经 write 回调与 out.end 的 promise 传递；此监听仅防取消/清理竞态下的未消费 error 事件
  out.on('error', () => {})
  const write = (buf: Buffer) =>
    new Promise<void>((resolve, reject) => {
      out.write(buf, (err) => (err ? reject(err) : resolve()))
    })
  const central: {
    name: Buffer
    method: number
    crc: number
    csize: number
    usize: number
    offset: number
    time: number
    date: number
  }[] = []
  let offset = 0
  let done = 0
  try {
    for (const e of entries) {
      if (isCancelled()) return { canceled: true }
      const nameBuf = Buffer.from(e.name, 'utf8')
      const st = await fsp.stat(e.abs)
      const { time, date } = dosDateTime(st.mtime)
      const header = Buffer.alloc(30)
      header.writeUInt32LE(0x04034b50, 0)
      header.writeUInt16LE(20, 4) // version needed: 2.0
      header.writeUInt16LE(0x800, 6) // UTF-8 文件名
      header.writeUInt16LE(time, 10)
      header.writeUInt16LE(date, 12)
      header.writeUInt16LE(nameBuf.length, 26)
      header.writeUInt16LE(0, 28)
      let method = 8
      let crc: number
      let usize: number
      let data: Buffer
      if (st.size <= storeThreshold) {
        const raw = await fsp.readFile(e.abs)
        crc = crc32(raw)
        usize = raw.length
        const deflated = zlib.deflateRawSync(raw, { level: 6 })
        if (deflated.length < raw.length) {
          data = deflated
        } else {
          method = 0
          data = raw
        }
      } else {
        // STORE 流式：先算 CRC 写头，再流式拷贝原文
        method = 0
        crc = await crc32File(e.abs)
        usize = st.size
        data = Buffer.alloc(0)
      }
      const csize = method === 8 ? data.length : usize
      header.writeUInt16LE(method, 8)
      header.writeUInt32LE(crc, 14)
      header.writeUInt32LE(csize, 18)
      header.writeUInt32LE(usize, 22)
      await write(header)
      await write(nameBuf)
      if (method === 8) {
        await write(data)
      } else if (st.size > storeThreshold) {
        await pipeline(fs.createReadStream(e.abs, { highWaterMark: 1 << 20 }), out, { end: false })
      } else {
        await write(data) // 小文件 STORE：deflate 无收益的短 buffer
      }
      central.push({ name: nameBuf, method, crc, csize, usize, offset, time, date })
      offset += 30 + nameBuf.length + csize
      done += usize
      onProgress(done, totalBytes, e.name)
    }
    // 中央目录 + EOCD
    const cdStart = offset
    for (const c of central) {
      const h = Buffer.alloc(46)
      h.writeUInt32LE(0x02014b50, 0)
      h.writeUInt16LE(20, 4) // version made by
      h.writeUInt16LE(20, 6) // version needed
      h.writeUInt16LE(0x800, 8)
      h.writeUInt16LE(c.method, 10)
      h.writeUInt16LE(c.time, 12)
      h.writeUInt16LE(c.date, 14)
      h.writeUInt32LE(c.crc, 16)
      h.writeUInt32LE(c.csize, 20)
      h.writeUInt32LE(c.usize, 24)
      h.writeUInt16LE(c.name.length, 28)
      h.writeUInt32LE(c.offset, 42)
      await write(h)
      await write(c.name)
      offset += 46 + c.name.length
    }
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(central.length, 8)
    eocd.writeUInt16LE(central.length, 10)
    eocd.writeUInt32LE(offset - cdStart, 12)
    eocd.writeUInt32LE(cdStart, 16)
    await write(eocd)
    await new Promise<void>((resolve, reject) =>
      out.end((err?: Error | null) => (err ? reject(err) : resolve())),
    )
    return { canceled: false, files: central.length, bytes: totalBytes }
  } finally {
    if (!out.writableEnded) out.destroy()
  }
}

/* ---------- 路径安全 ---------- */

const lcPath = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)

/** dest 必须严格位于 targetDir 内，且不得与源目录互相包含（防复制进自身导致越滚越大） */
export function resolveSafeDest(targetDir: string, backupName: string, sourcePath: string): string {
  const target = path.resolve(targetDir)
  const dest = path.resolve(target, backupName)
  if (lcPath(dest) !== target && !lcPath(dest).startsWith(lcPath(target) + path.sep)) {
    throw new Error('备份目标越界')
  }
  const source = path.resolve(sourcePath)
  if (
    lcPath(dest) === lcPath(source) ||
    lcPath(dest).startsWith(lcPath(source) + path.sep) ||
    lcPath(source).startsWith(lcPath(dest) + path.sep)
  ) {
    throw new Error('备份目标不能与源目录重叠')
  }
  return dest
}

/** 校验调用方传回的路径与最近一次对话框选择一致（会话绑定，防任意路径读写） */
function requireBound(value: unknown, bound: string | null, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`请先选择${label}`)
  const resolved = path.resolve(value)
  if (!bound || resolved !== bound) throw new Error(`${label}与会话选择不一致，请重新选择`)
  return resolved
}

/* ---------- IPC 注册 ---------- */

let lastSourceDir: string | null = null
let lastTargetDir: string | null = null
let busy = false
let cancelled = false

export function registerBackupIpc() {
  ipcMain.handle('backup:pickSource', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: '选择要备份的文件夹',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const dir = path.resolve(result.filePaths[0])
    lastSourceDir = dir
    return { canceled: false, path: dir, name: path.basename(dir), suggestedName: defaultBackupName(path.basename(dir)) }
  })

  ipcMain.handle('backup:pickTarget', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      title: '选择备份保存位置',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const dir = path.resolve(result.filePaths[0])
    lastTargetDir = dir
    return { canceled: false, path: dir }
  })

  // 预估：只扫描不复制，返回将复制的文件数/体积与各类跳过计数
  ipcMain.handle('backup:estimate', async (_event, args: { sourcePath?: string; excludes?: unknown }) => {
    if (busy) throw new Error('已有备份任务进行中')
    const source = requireBound(args?.sourcePath, lastSourceDir, '源文件夹')
    busy = true
    try {
      const scan = await walkSource(source, createBackupMatcher(sanitizeExcludes(args?.excludes)))
      return {
        fileCount: scan.files.length,
        totalBytes: scan.files.reduce((s, f) => s + f.size, 0),
        skippedFiles: scan.skippedFiles,
        skippedDirs: scan.skippedDirs,
        skippedSymlinks: scan.skippedSymlinks,
        errorCount: scan.errors.length,
      }
    } finally {
      busy = false
    }
  })

  ipcMain.handle(
    'backup:run',
    async (
      event,
      args: {
        sourcePath?: string
        targetDir?: string
        backupName?: string
        excludes?: unknown
        overwrite?: boolean
        zip?: boolean
      },
    ) => {
      if (busy) throw new Error('已有备份任务进行中')
      const source = requireBound(args?.sourcePath, lastSourceDir, '源文件夹')
      const target = requireBound(args?.targetDir, lastTargetDir, '保存位置')
      const nameError = validateBackupName(String(args?.backupName ?? ''))
      if (nameError) throw new Error(nameError)
      const backupName = String(args?.backupName).trim()
      const dest = resolveSafeDest(target, backupName, source)

      const exists = await fsp
        .access(dest)
        .then(() => true)
        .catch(() => false)
      if (exists && !args?.overwrite) throw new Error(`备份目录已存在：${backupName}（可勾选覆盖后重试）`)

      const sender = event.sender
      let lastSent = 0
      const sendProgress = (
        phase: 'scan' | 'copy' | 'zip',
        total: number,
        copied: number,
        current: string,
        force = false,
      ) => {
        const now = Date.now()
        if (!force && now - lastSent < 250) return
        lastSent = now
        if (!sender.isDestroyed()) sender.send('backup:progress', { phase, total, copied, current })
      }

      busy = true
      cancelled = false
      const started = Date.now()
      try {
        await fsp.mkdir(dest, { recursive: true })
        const scan = await walkSource(source, createBackupMatcher(sanitizeExcludes(args?.excludes)), (rel) => {
          sendProgress('scan', 0, 0, rel)
        })
        const total = scan.files.length
        sendProgress('copy', total, 0, '', true)
        const outcome = await copyFiles(
          scan.files,
          dest,
          (copied) => sendProgress('copy', total, copied, ''),
          () => cancelled,
        )

        // 备份后压缩：按成功复制清单打包为 zip，成功后移除临时文件夹
        let zipCanceled = false
        let zipPath: string | null = null
        if (args?.zip) {
          const zipName = `${backupName}.zip`
          const zipDest = resolveSafeDest(target, zipName, source)
          const zipExists = await fsp
            .access(zipDest)
            .then(() => true)
            .catch(() => false)
          if (zipExists && !args.overwrite) throw new Error(`同名压缩包已存在：${zipName}（可勾选覆盖后重试）`)
          const sizeByRel = new Map(scan.files.map((f) => [f.rel, f.size] as const))
          const entries: ZipEntry[] = outcome.copiedRels.map((rel) => ({
            name: rel,
            abs: path.join(dest, ...rel.split('/')),
            size: sizeByRel.get(rel) ?? 0,
          }))
          sendProgress('zip', outcome.copiedBytes, 0, '', true)
          try {
            const zr = await writeZip(
              zipDest,
              entries,
              (doneB, totB, cur) => sendProgress('zip', totB, doneB, cur),
              () => cancelled,
            )
            if (zr.canceled) {
              zipCanceled = true
              await fsp.rm(zipDest, { force: true }).catch(() => {})
            } else {
              zipPath = zipDest
              await fsp.rm(dest, { recursive: true, force: true })
            }
          } catch (err) {
            await fsp.rm(zipDest, { force: true }).catch(() => {})
            throw err
          }
        }

        return {
          canceled: outcome.canceled || zipCanceled,
          destPath: zipPath ?? dest,
          zipPath,
          totalFound: total,
          copied: outcome.copied,
          copiedBytes: outcome.copiedBytes,
          skippedFiles: scan.skippedFiles,
          skippedDirs: scan.skippedDirs,
          skippedSymlinks: scan.skippedSymlinks,
          errors: [...scan.errors, ...outcome.errors].slice(0, MAX_ERRORS),
          durationMs: Date.now() - started,
        }
      } finally {
        busy = false
      }
    },
  )

  ipcMain.handle('backup:cancel', () => {
    if (busy) cancelled = true
    return true
  })
}
