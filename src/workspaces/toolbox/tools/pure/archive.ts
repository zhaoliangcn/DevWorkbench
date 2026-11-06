/**
 * 文件解压纯函数引擎（工具箱）。
 *
 * 字节进 / 字节（或字节流）出，无 IO、无 IPC、无 Electron 依赖：
 * - 渲染层 ArchiveTool 经 archive:readBytes 取字节后，在本引擎完成格式识别、条目列表、
 *   安全路径净化、同名策略规划与逐条解压，再经 archive:writeStart / writeBatch / finish 落盘；
 * - 主进程只保留会话绑定的文件选择、字节读取与落盘（electron tsconfig rootDir 限制
 *   无法反向 import src/，与 pure/pdf.ts 同一取舍）；
 * - 解压复用 Web 标准 DecompressionStream（Chromium / Node 18+ 均可用），零新增依赖；
 * - RAR / 7z 不在支持范围：Node 标准库无实现，需外部二进制或大型 WASM 解析库，
 *   违背「优先标准库、不随意加依赖」的约定，由调用方展示明确提示。
 */

/** 解压后总大小上限（防压缩炸弹与渲染层内存失控） */
export const MAX_TOTAL_UNCOMPRESSED = 512 * 1024 * 1024
/** 单包条目上限（超大包只解析前 N 条，UI 会提示截断） */
export const MAX_ARCHIVE_ENTRIES = 100000

export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz' | 'gz' | 'rar' | '7z' | 'unknown'
/** prepareArchive 之后的实际解析格式（tar.gz 已解压为 tar） */
export type PreparedFormat = 'zip' | 'tar' | 'gz'

export interface FormatInfo {
  format: ArchiveFormat
  supported: boolean
  /** 不支持时的原因（直接展示给用户） */
  reason?: string
}

export interface ArchiveEntry {
  index: number
  /** 压缩包内原始路径（'/' 分隔） */
  rawPath: string
  /** 净化后的安全相对路径；不安全时为 null */
  path: string | null
  unsafeReason?: string
  kind: 'file' | 'dir' | 'symlink' | 'hardlink' | 'other'
  /** 解压后大小（gz 单文件在列表阶段未知，为 0） */
  size: number
  /** 压缩后大小（tar 无此信息，为 0） */
  compressedSize: number
  encrypted: boolean
  /** 压缩方法等不支持原因 */
  unsupportedReason?: string
  /** gz 单文件在列表阶段大小未知 */
  sizeUnknown?: boolean
}

export interface ArchiveInspection {
  format: PreparedFormat
  entries: ArchiveEntry[]
  /** 中央目录/包头声明的条目总数（可能大于 entries.length） */
  declaredCount: number
  truncated: boolean
  /** 可解压文件的解压后总字节数（gz 未知时为 0） */
  totalBytes: number
  totalFiles: number
  totalDirs: number
  encryptedCount: number
  unsafeCount: number
  symlinkCount: number
  unsupportedCount: number
  warnings: string[]
}

/* ---------- 格式识别 ---------- */

const ZIP_EXTENSIONS = new Set(['zip', 'jar', 'war', 'ear', 'apk', 'xpi'])

function extensionOf(fileName: string): string {
  const lower = (fileName || '').toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot + 1) : ''
}

function hasPrefix(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false
  return true
}

function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08])
  )
}

function looksLikeGzip(bytes: Uint8Array): boolean {
  return hasPrefix(bytes, [0x1f, 0x8b])
}

function looksLikeRar(bytes: Uint8Array): boolean {
  return hasPrefix(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])
}

function looksLike7z(bytes: Uint8Array): boolean {
  return hasPrefix(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
}

function looksLikeTar(bytes: Uint8Array): boolean {
  if (bytes.length < 263) return false
  return asciiAt(bytes, 257, 5) === 'ustar'
}

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  let s = ''
  for (let i = start; i < start + length && i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return s
}

const RAR_REASON = '暂不支持 RAR：需要外部 unrar 二进制，本工具坚持零额外依赖'
const SEVEN_Z_REASON = '暂不支持 7z：需要 7z 可执行文件或 WASM 解析库，会引入额外依赖'
const UNKNOWN_REASON = '无法识别的压缩格式（支持 zip / tar / tar.gz / tgz / gz）'

/**
 * 识别压缩格式：优先看文件魔数（防扩展名造假/缺失），再回退扩展名。
 * gz 与 tar.gz 无法仅凭字节区分，按扩展名决定是否按 tar 解析。
 */
export function detectArchiveFormat(fileName: string, bytes?: Uint8Array): FormatInfo {
  const lower = (fileName || '').toLowerCase()
  const ext = extensionOf(fileName)
  const isTgzName = lower.endsWith('.tar.gz') || lower.endsWith('.tgz')

  if (bytes && bytes.length > 0) {
    if (looksLikeRar(bytes)) return { format: 'rar', supported: false, reason: RAR_REASON }
    if (looksLike7z(bytes)) return { format: '7z', supported: false, reason: SEVEN_Z_REASON }
    if (looksLikeGzip(bytes)) {
      return isTgzName
        ? { format: 'tar.gz', supported: true }
        : { format: 'gz', supported: true }
    }
    if (looksLikeZip(bytes)) return { format: 'zip', supported: true }
    if (looksLikeTar(bytes)) return { format: 'tar', supported: true }
  }

  if (isTgzName) return { format: 'tar.gz', supported: true }
  if (lower.endsWith('.tar')) return { format: 'tar', supported: true }
  if (lower.endsWith('.gz')) return { format: 'gz', supported: true }
  if (ZIP_EXTENSIONS.has(ext)) return { format: 'zip', supported: true }
  if (ext === 'rar') return { format: 'rar', supported: false, reason: RAR_REASON }
  if (ext === '7z') return { format: '7z', supported: false, reason: SEVEN_Z_REASON }
  return { format: 'unknown', supported: false, reason: UNKNOWN_REASON }
}

/* ---------- 解压原语（Web 标准流，无第三方依赖） ---------- */

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.length) {
        chunks.push(value)
        total += value.length
      }
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

async function decompressWeb(bytes: Uint8Array, format: 'gzip' | 'deflate-raw'): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const transform = new DecompressionStream(format) as unknown as TransformStream<Uint8Array, Uint8Array>
  const piped = source.pipeThrough(transform)
  return readAll(piped)
}

/** gzip 解压（失败时给出统一可读提示） */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    return await decompressWeb(bytes, 'gzip')
  } catch {
    throw new Error('gzip 解压失败：文件可能已损坏或不是有效的 gzip')
  }
}

/** tar.gz 预解压为 tar；其余格式原样返回 */
export async function prepareArchive(
  bytes: Uint8Array,
  format: ArchiveFormat,
): Promise<{ format: PreparedFormat; bytes: Uint8Array }> {
  if (format === 'tar.gz') {
    const tar = await gunzip(bytes)
    return { format: 'tar', bytes: tar }
  }
  if (format === 'zip' || format === 'tar' || format === 'gz') return { format, bytes }
  throw new Error(detectArchiveFormat('', bytes).reason ?? '暂不支持该压缩格式')
}

export interface GzipHeader {
  /** gzip 头内记录的原始文件名（可能为空） */
  name?: string
  /** 原始修改时间（如存在） */
  mtime?: number
}

/** 解析 gzip 头（仅读取 FNAME / MTIME，用于单文件解压的默认文件名） */
export function parseGzipHeader(bytes: Uint8Array): GzipHeader {
  if (bytes.length < 10 || !looksLikeGzip(bytes)) return {}
  const flags = bytes[3]
  const header: GzipHeader = {
    mtime: bytes[4] + bytes[5] * 256 + bytes[6] * 65536 + bytes[7] * 16777216,
  }
  let p = 10
  if (flags & 0x04) {
    // FEXTRA：2 字节长度 + 数据
    if (p + 2 > bytes.length) return header
    const xlen = bytes[p] + bytes[p + 1] * 256
    p += 2 + xlen
  }
  if (flags & 0x08 && p < bytes.length) {
    // FNAME：NUL 结尾
    let end = p
    while (end < bytes.length && bytes[end] !== 0) end++
    if (end > p) header.name = new TextDecoder().decode(bytes.subarray(p, end))
  }
  return header
}

/* ---------- 路径安全 ---------- */

export interface SafePathResult {
  ok: boolean
  path?: string
  reason?: string
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return true
  }
  return false
}

/**
 * 净化压缩包内条目路径：
 * - 统一反斜杠、丢弃 '.' 段；
 * - 拒绝绝对路径（/ 开头、盘符、UNC）、任何 '..' 段、NUL/控制字符；
 * - 拒绝 Windows 非法字符与保留设备名（跨平台工具按最严格平台约束，避免 Windows 落盘失败）。
 */
export function sanitizeEntryPath(raw: string): SafePathResult {
  const unified = String(raw ?? '').replace(/\\/g, '/')
  if (!unified.trim()) return { ok: false, reason: '路径为空' }
  if (hasControlChar(unified)) return { ok: false, reason: '包含控制字符' }
  if (unified.startsWith('/')) return { ok: false, reason: '绝对路径' }
  if (/^[a-zA-Z]:/.test(unified)) return { ok: false, reason: '绝对路径（盘符）' }
  if (unified.startsWith('//')) return { ok: false, reason: '绝对路径（UNC）' }

  const segments: string[] = []
  for (const seg of unified.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') return { ok: false, reason: '包含上级目录引用（..）' }
    if (/[:*?"<>|]/.test(seg)) return { ok: false, reason: '包含 Windows 非法字符' }
    if (seg.endsWith('.') || seg.endsWith(' ')) return { ok: false, reason: '名称以点号或空格结尾' }
    if (WINDOWS_RESERVED.test(seg)) return { ok: false, reason: 'Windows 保留设备名' }
    segments.push(seg)
  }
  if (!segments.length) return { ok: false, reason: '路径为空' }
  const joined = segments.join('/')
  if (joined.length > 300) return { ok: false, reason: '路径过长' }
  return { ok: true, path: joined }
}

/* ---------- zip 解析 ---------- */

interface RawEntry {
  index: number
  rawPath: string
  kind: ArchiveEntry['kind']
  size: number
  compressedSize: number
  encrypted: boolean
  unsupportedReason?: string
  /** zip：本地文件头偏移与压缩方法 */
  localOffset?: number
  method?: number
  /** tar：数据区起点与长度 */
  dataStart?: number
  dataLen?: number
}

interface ParsedRaw {
  entries: RawEntry[]
  declared: number
  truncated: boolean
}

const ZIP_SUPPORTED_METHODS = new Set([0, 8])

function corrupt(message = '压缩包已损坏或格式不正确'): Error {
  return new Error(message)
}

function zipKind(rawPath: string, externalAttr: number): ArchiveEntry['kind'] {
  const unixMode = (externalAttr >>> 16) & 0xffff
  const unixType = unixMode & 0xf000
  if (rawPath.endsWith('/') || unixType === 0x4000 || (externalAttr & 0x10) !== 0) return 'dir'
  if (unixType === 0xa000) return 'symlink'
  return 'file'
}

function parseZipEntries(bytes: Uint8Array): ParsedRaw {
  const len = bytes.length
  if (len < 22) throw corrupt()
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (o: number): number => {
    if (o + 2 > len) throw corrupt()
    return dv.getUint16(o, true)
  }
  const u32 = (o: number): number => {
    if (o + 4 > len) throw corrupt()
    return dv.getUint32(o, true)
  }
  const u64 = (o: number): number => {
    if (o + 8 > len) throw corrupt()
    const v = dv.getBigUint64(o, true)
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw corrupt('压缩包尺寸超出可处理范围')
    return Number(v)
  }

  // 反向扫描 EOCD，并要求注释长度恰好到文件末尾（避免注释里伪造的签名）
  let eocd = -1
  const min = Math.max(0, len - 22 - 65535)
  for (let i = len - 22; i >= min; i--) {
    if (u32(i) !== 0x06054b50) continue
    const commentLen = u16(i + 20)
    if (i + 22 + commentLen === len) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw corrupt('未找到 zip 中央目录，可能不是有效的 zip 文件')

  let total = u16(eocd + 10)
  let cdSize = u32(eocd + 12)
  let cdOffset = u32(eocd + 16)

  // zip64：EOCD 字段溢出时读 zip64 EOCD 记录
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locator = eocd - 20
    if (locator >= 0 && u32(locator) === 0x07064b50) {
      const z64Offset = u64(locator + 8)
      if (u32(z64Offset) !== 0x06064b50) throw corrupt('zip64 中央目录记录无效')
      total = u64(z64Offset + 32)
      cdSize = u64(z64Offset + 40)
      cdOffset = u64(z64Offset + 48)
    }
  }

  if (cdOffset < 0 || cdSize < 0 || cdOffset + cdSize > len) throw corrupt('zip 中央目录越界')

  const entries: RawEntry[] = []
  let p = cdOffset
  for (let i = 0; i < total; i++) {
    if (i >= MAX_ARCHIVE_ENTRIES) break
    if (p + 46 > len || u32(p) !== 0x02014b50) throw corrupt('zip 中央目录条目损坏')
    const flags = u16(p + 8)
    const method = u16(p + 10)
    let csize = u32(p + 20)
    let usize = u32(p + 24)
    const nameLen = u16(p + 28)
    const extraLen = u16(p + 30)
    const commentLen = u16(p + 32)
    const externalAttr = u32(p + 38)
    let localOffset = u32(p + 42)
    if (p + 46 + nameLen + extraLen + commentLen > len) throw corrupt('zip 中央目录条目越界')

    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen)
    const rawPath = new TextDecoder().decode(nameBytes)

    // zip64 扩展字段：仅在对应 32 位字段溢出时存在，顺序 usize → csize → offset
    const usizeOverflow = usize === 0xffffffff
    const csizeOverflow = csize === 0xffffffff
    const offsetOverflow = localOffset === 0xffffffff
    if (usizeOverflow || csizeOverflow || offsetOverflow) {
      let q = p + 46 + nameLen
      const end = q + extraLen
      let resolved = false
      while (q + 4 <= end) {
        const id = u16(q)
        const size = u16(q + 2)
        const dataStart = q + 4
        if (dataStart + size > end) throw corrupt('zip 扩展字段越界')
        if (id === 0x0001) {
          let r = dataStart
          if (usizeOverflow) {
            usize = u64(r)
            r += 8
          }
          if (csizeOverflow) {
            csize = u64(r)
            r += 8
          }
          if (offsetOverflow) localOffset = u64(r)
          resolved = true
          break
        }
        q = dataStart + size
      }
      if (!resolved) throw corrupt('zip 缺少 zip64 扩展字段')
    }

    const encrypted = (flags & 0x1) !== 0 || method === 99
    const entry: RawEntry = {
      index: i,
      rawPath,
      kind: zipKind(rawPath, externalAttr),
      size: usize,
      compressedSize: csize,
      encrypted,
      localOffset,
      method,
    }
    if (!encrypted && !ZIP_SUPPORTED_METHODS.has(method)) {
      entry.unsupportedReason = `压缩方法 ${method} 暂不支持（仅支持 Store/Deflate）`
    }
    entries.push(entry)

    p += 46 + nameLen + extraLen + commentLen
  }

  return { entries, declared: total, truncated: total > entries.length }
}

function zipEntryData(bytes: Uint8Array, entry: RawEntry): Uint8Array {
  if (entry.localOffset === undefined || entry.method === undefined) throw corrupt()
  const len = bytes.length
  const local = entry.localOffset
  if (local + 30 > len) throw corrupt('zip 本地文件头越界')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(local, true) !== 0x04034b50) throw corrupt('zip 本地文件头签名无效')
  const nameLen = dv.getUint16(local + 26, true)
  const extraLen = dv.getUint16(local + 28, true)
  const start = local + 30 + nameLen + extraLen
  const end = start + entry.compressedSize
  if (start > len || end > len) throw corrupt('zip 条目数据越界')
  return bytes.subarray(start, end)
}

/* ---------- tar 解析 ---------- */

function tarReadString(block: Uint8Array, offset: number, length: number): string {
  let end = offset
  const limit = offset + length
  while (end < limit && block[end] !== 0) end++
  return new TextDecoder().decode(block.subarray(offset, end))
}

/** tar 数字字段：八进制（可带空格/NUL）或 GNU base-256 */
function tarNumber(block: Uint8Array, offset: number, length: number): number {
  const first = block[offset]
  if (first & 0x80) {
    let value = first & 0x7f
    for (let i = 1; i < length; i++) value = value * 256 + block[offset + i]
    if (!Number.isSafeInteger(value)) throw corrupt('tar 数值字段超出可处理范围')
    return value
  }
  let digits = ''
  for (let i = 0; i < length; i++) {
    const ch = block[offset + i]
    if (ch === 0 || ch === 32) {
      if (digits) break
      continue
    }
    if (ch < 48 || ch > 55) break
    digits += String.fromCharCode(ch)
  }
  return digits ? parseInt(digits, 8) : 0
}

function tarKind(type: string): ArchiveEntry['kind'] {
  if (type === '5') return 'dir'
  if (type === '2') return 'symlink'
  if (type === '1') return 'hardlink'
  if (type === '0' || type === '7' || type === '\0') return 'file'
  return 'other'
}

function parsePax(data: Uint8Array): Record<string, string> {
  const text = new TextDecoder().decode(data)
  const out: Record<string, string> = {}
  let p = 0
  while (p < text.length) {
    const space = text.indexOf(' ', p)
    if (space < 0) break
    const recordLen = Number(text.slice(p, space))
    if (!Number.isFinite(recordLen) || recordLen <= 0) break
    const record = text.slice(space + 1, p + recordLen).replace(/\n$/, '')
    const eq = record.indexOf('=')
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1)
    p += recordLen
  }
  return out
}

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false
  return true
}

function parseTarEntries(bytes: Uint8Array): ParsedRaw {
  const len = bytes.length
  if (len < 512) throw corrupt('文件太小，不是有效的 tar')
  const entries: RawEntry[] = []
  let p = 0
  let longName: string | null = null
  let pax: Record<string, string> = {}
  let index = 0

  while (p + 512 <= len) {
    const block = bytes.subarray(p, p + 512)
    if (isZeroBlock(block)) break
    const headerName = tarReadString(block, 0, 100)
    const sizeField = tarNumber(block, 124, 12)
    const type = String.fromCharCode(block[156] || 0)
    const prefix = tarReadString(block, 345, 155)
    const dataStart = p + 512
    const dataLen = Math.max(0, sizeField)
    if (dataStart + dataLen > len) throw corrupt('tar 数据越界或已截断')
    const padded = Math.ceil(dataLen / 512) * 512
    const data = bytes.subarray(dataStart, dataStart + dataLen)

    // GNU 长名 / PAX 扩展头：先消费，再作用于下一个真实条目
    if (type === 'L') {
      longName = new TextDecoder().decode(data).replace(/\0+$/, '')
    } else if (type === 'K') {
      // GNU 长链接名：硬链接一律跳过，仅消费该扩展头
    } else if (type === 'x') {
      pax = parsePax(data)
    } else if (type === 'g') {
      // 全局 PAX 头：忽略
    } else {
      if (!headerName && !longName && !pax.path) throw corrupt('tar 条目名称为空')
      const rawName = pax.path ?? longName ?? (prefix ? `${prefix}/${headerName}` : headerName)
      const kind = tarKind(type)
      // PAX 可为超大文件提供 size；异常值回退到包头 size，避免畸形数据
      const paxSize = pax.size ? Number(pax.size) : NaN
      const size = Number.isSafeInteger(paxSize) && paxSize >= 0 ? paxSize : dataLen
      const entry: RawEntry = {
        index: index++,
        rawPath: rawName,
        kind,
        size: kind === 'dir' ? 0 : size,
        compressedSize: 0,
        encrypted: false,
        dataStart,
        dataLen,
      }
      entries.push(entry)
      longName = null
      pax = {}
    }
    if (entries.length >= MAX_ARCHIVE_ENTRIES) break
    p = dataStart + padded
  }

  const truncated = entries.length >= MAX_ARCHIVE_ENTRIES
  return { entries, declared: entries.length, truncated }
}

/* ---------- 列表 ---------- */

/**
 * 解析压缩包条目列表（不落盘）。
 * tar.gz 需先经 prepareArchive 解压为 tar；gz 直接给出单文件条目（大小待解压后确定）。
 */
export async function inspectArchive(
  bytes: Uint8Array,
  format: PreparedFormat,
  fileName?: string,
): Promise<ArchiveInspection> {
  let raw: ParsedRaw
  if (format === 'zip') raw = parseZipEntries(bytes)
  else if (format === 'tar') raw = parseTarEntries(bytes)
  else {
    const header = parseGzipHeader(bytes)
    const fallback = fileName ? fileName.replace(/\.gz$/i, '') : 'ungzipped'
    const name = header.name || fallback
    raw = {
      entries: [
        {
          index: 0,
          rawPath: name,
          kind: 'file',
          size: 0,
          compressedSize: bytes.length,
          encrypted: false,
        },
      ],
      declared: 1,
      truncated: false,
    }
  }

  const entries: ArchiveEntry[] = raw.entries.map((entry) => {
    const safe = sanitizeEntryPath(entry.rawPath)
    const out: ArchiveEntry = {
      index: entry.index,
      rawPath: entry.rawPath,
      path: safe.ok ? safe.path! : null,
      kind: entry.kind,
      size: entry.size,
      compressedSize: entry.compressedSize,
      encrypted: entry.encrypted,
    }
    if (!safe.ok) out.unsafeReason = safe.reason
    if (entry.unsupportedReason) out.unsupportedReason = entry.unsupportedReason
    if (format === 'gz') out.sizeUnknown = true
    return out
  })

  const files = entries.filter((e) => e.kind === 'file' && !e.encrypted && !e.unsupportedReason)
  const totalBytes = files.reduce((sum, e) => sum + (e.sizeUnknown ? 0 : e.size), 0)
  const warnings: string[] = []
  if (raw.truncated) {
    warnings.push(`条目数超过 ${MAX_ARCHIVE_ENTRIES} 条，列表与解压仅处理前 ${MAX_ARCHIVE_ENTRIES} 条`)
  }
  if (format === 'gz') warnings.push('gz 为单文件压缩，解压后文件名取自压缩包头或去扩展名，大小在解压时确定')
  if (totalBytes > MAX_TOTAL_UNCOMPRESSED) {
    warnings.push(`解压后总大小超过 ${MAX_TOTAL_UNCOMPRESSED / 1024 / 1024}MB 上限，将无法解压`)
  }

  return {
    format,
    entries,
    declaredCount: raw.declared,
    truncated: raw.truncated,
    totalBytes,
    totalFiles: entries.filter((e) => e.kind === 'file').length,
    totalDirs: entries.filter((e) => e.kind === 'dir').length,
    encryptedCount: entries.filter((e) => e.encrypted).length,
    unsafeCount: entries.filter((e) => e.path === null).length,
    symlinkCount: entries.filter((e) => e.kind === 'symlink' || e.kind === 'hardlink').length,
    unsupportedCount: entries.filter((e) => e.unsupportedReason).length,
    warnings,
  }
}

/* ---------- 同名策略规划 ---------- */

export type ConflictPolicy = 'overwrite' | 'skip' | 'rename'
export type SkipReason = 'unsafe' | 'symlink' | 'hardlink' | 'encrypted' | 'unsupported' | 'duplicate' | 'other'

export interface PlannedEntry {
  index: number
  /** 写入目标相对路径（'/' 分隔）；null 表示跳过 */
  targetPath: string | null
  skipReason?: SkipReason
}

export interface PlanOptions {
  conflict: ConflictPolicy
  /** 用于判断同名冲突是否大小写敏感（Windows / macOS 默认不敏感） */
  platform?: 'win32' | 'darwin' | 'linux' | 'browser'
}

export interface PlanResult {
  items: PlannedEntry[]
  /** 规划后实际会写出的文件/目录数 */
  plannedCount: number
  skipped: Record<SkipReason, number>
}

function keyOf(pathValue: string, caseInsensitive: boolean): string {
  return caseInsensitive ? pathValue.toLowerCase() : pathValue
}

/** 生成不与 occupied 冲突的新名称：name (1).ext */
export function uniqueEntryPath(
  candidate: string,
  occupied: Set<string>,
  caseInsensitive: boolean,
): string {
  const slash = candidate.lastIndexOf('/')
  const dir = slash >= 0 ? candidate.slice(0, slash + 1) : ''
  const base = slash >= 0 ? candidate.slice(slash + 1) : candidate
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  for (let i = 1; i < 1000; i++) {
    const next = `${dir}${stem} (${i})${ext}`
    if (!occupied.has(keyOf(next, caseInsensitive))) return next
  }
  throw new Error('同名条目过多，无法自动重命名')
}

/**
 * 生成解压计划：净化已由 inspectArchive 完成，这里处理符号链接/硬链接/加密/不支持方法，
 * 并按策略处理压缩包内部同名条目（目标目录中已存在的同名文件由主进程落盘时再次处理）。
 */
export function planExtraction(inspection: ArchiveInspection, options: PlanOptions): PlanResult {
  const caseInsensitive = options.platform === 'win32' || options.platform === 'darwin'
  const occupied = new Set<string>()
  const items: PlannedEntry[] = []
  const skipped: Record<SkipReason, number> = {
    unsafe: 0,
    symlink: 0,
    hardlink: 0,
    encrypted: 0,
    unsupported: 0,
    duplicate: 0,
    other: 0,
  }

  for (const entry of inspection.entries) {
    if (entry.path === null) {
      items.push({ index: entry.index, targetPath: null, skipReason: 'unsafe' })
      skipped.unsafe++
      continue
    }
    if (entry.kind === 'symlink') {
      items.push({ index: entry.index, targetPath: null, skipReason: 'symlink' })
      skipped.symlink++
      continue
    }
    if (entry.kind === 'hardlink') {
      items.push({ index: entry.index, targetPath: null, skipReason: 'hardlink' })
      skipped.hardlink++
      continue
    }
    if (entry.encrypted) {
      items.push({ index: entry.index, targetPath: null, skipReason: 'encrypted' })
      skipped.encrypted++
      continue
    }
    if (entry.unsupportedReason) {
      items.push({ index: entry.index, targetPath: null, skipReason: 'unsupported' })
      skipped.unsupported++
      continue
    }
    if (entry.kind !== 'file' && entry.kind !== 'dir') {
      items.push({ index: entry.index, targetPath: null, skipReason: 'other' })
      skipped.other++
      continue
    }

    let target = entry.path
    const k = keyOf(target, caseInsensitive)
    if (occupied.has(k)) {
      if (options.conflict === 'skip') {
        items.push({ index: entry.index, targetPath: null, skipReason: 'duplicate' })
        skipped.duplicate++
        continue
      }
      if (options.conflict === 'rename') {
        target = uniqueEntryPath(target, occupied, caseInsensitive)
      }
    }
    occupied.add(keyOf(target, caseInsensitive))
    items.push({ index: entry.index, targetPath: target })
  }

  return {
    items,
    plannedCount: items.filter((i) => i.targetPath !== null).length,
    skipped,
  }
}

/* ---------- 逐条解压（异步生成器，便于分批落盘与取消） ---------- */

export interface ExtractedItem {
  index: number
  /** 相对路径（'/' 分隔） */
  path: string
  kind: 'file' | 'dir'
  size: number
  data?: Uint8Array
}

export interface ExtractionHooks {
  /** doneBytes 以「已解压字节」计；totalBytes 来自列表（gz 未知时为 1） */
  onProgress?: (doneBytes: number, totalBytes: number, current: string) => void
  isCancelled?: () => boolean
}

/**
 * 逐条解压。调用方按需分批写入磁盘；isCancelled 返回 true 时生成器提前结束。
 * 超过 MAX_TOTAL_UNCOMPRESSED 或条目数据异常时抛错，调用方据此清理半成品。
 */
export async function* extractArchive(
  bytes: Uint8Array,
  format: PreparedFormat,
  inspection: ArchiveInspection,
  plan: PlannedEntry[],
  hooks: ExtractionHooks = {},
): AsyncGenerator<ExtractedItem> {
  const planned = new Map(plan.map((item) => [item.index, item] as const))
  const total = Math.max(inspection.totalBytes, 1)
  let done = 0
  const cancelled = () => hooks.isCancelled?.() === true
  const report = (current: string) => hooks.onProgress?.(done, total, current)

  if (format === 'gz') {
    if (cancelled()) return
    const target = planned.get(inspection.entries[0]?.index ?? 0)
    if (!target?.targetPath) return
    const data = await gunzip(bytes)
    if (data.length > MAX_TOTAL_UNCOMPRESSED) {
      throw new Error(`解压后文件超过 ${MAX_TOTAL_UNCOMPRESSED / 1024 / 1024}MB 上限`)
    }
    done = data.length
    report(target.targetPath)
    yield { index: target.index, path: target.targetPath, kind: 'file', size: data.length, data }
    return
  }

  const raw = format === 'zip' ? parseZipEntries(bytes) : parseTarEntries(bytes)
  for (const entry of raw.entries) {
    if (cancelled()) return
    const target = planned.get(entry.index)
    if (!target?.targetPath) continue

    if (entry.kind === 'dir') {
      yield { index: entry.index, path: target.targetPath, kind: 'dir', size: 0 }
      report(target.targetPath)
      continue
    }
    if (entry.kind !== 'file' || entry.encrypted || entry.unsupportedReason) continue

    let data: Uint8Array
    if (format === 'zip') {
      const compressed = zipEntryData(bytes, entry)
      if (entry.method === 0) {
        data = compressed
      } else if (entry.method === 8) {
        try {
          data = await decompressWeb(compressed, 'deflate-raw')
        } catch {
          throw new Error(`条目解压失败（数据损坏）：${entry.rawPath}`)
        }
      } else {
        continue
      }
    } else {
      const start = entry.dataStart ?? 0
      const dataLen = entry.dataLen ?? 0
      if (start + dataLen > bytes.length) throw corrupt('tar 条目数据越界')
      data = bytes.subarray(start, start + dataLen)
    }

    if (done + data.length > MAX_TOTAL_UNCOMPRESSED) {
      throw new Error(`解压后总大小超过 ${MAX_TOTAL_UNCOMPRESSED / 1024 / 1024}MB 上限，已中止`)
    }
    done += data.length
    report(target.targetPath)
    yield { index: entry.index, path: target.targetPath, kind: 'file', size: data.length, data }
  }
}
