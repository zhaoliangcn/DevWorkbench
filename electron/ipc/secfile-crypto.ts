/**
 * 文件保险柜加密核心（附录 B.7 延伸）。纯 Node（无 electron 依赖），vitest node 环境可直接测。
 * - 复用 secvault-crypto 的 scrypt 密钥派生与 AES-256-GCM 原语（同一主密码体系）
 * - 每个文件独立容器 files/<id>.bin：magic(8) | iv(12) | 密文（流式） | tag(16)
 *   GB 级文件不进内存；tag 在尾部，解密前单独读出 setAuthTag
 * - 原始文件名加密存 nameBlob；vault.json 只有 id/大小/时间，锁定态不泄露任何文件名
 * - 整库迁移 bundle（.wbvault）：magic(8) | manifestLen(4 LE) | 各容器字节顺序拼接 | manifest JSON（尾部）
 * - 加解密均支持进度回调与取消（isCancelled 在流 tap 中检查，抛 CancelError）
 */
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createReadStream, createWriteStream } from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { deriveKey, encryptRaw, decryptRaw, type VaultBlob } from './secvault-crypto.js'

export const CONTAINER_MAGIC = 'WBSECF01'
const HEADER_LEN = 8 + 12 // magic + iv
const TAG_LEN = 16
/** 容器相对明文的固定开销 */
export const CONTAINER_OVERHEAD = HEADER_LEN + TAG_LEN

const BUNDLE_MAGIC = 'WBXFER01'
const VERIFIER_PLAINTEXT = 'wb-secfile-verifier-v1'
/** 预览解密上限（5MB，超出拒绝进内存） */
export const PREVIEW_MAX_BYTES = 5 * 1024 * 1024

export class CancelError extends Error {
  constructor() {
    super('操作已取消')
    this.name = 'CancelError'
  }
}

export interface SecFileEntry {
  id: string
  /** 明文文件字节数 */
  size: number
  addedAt: string
  /** 加密后的原始文件名 */
  nameBlob: VaultBlob
}

export interface SecFileVault {
  version: 1
  salt: string
  verifier: VaultBlob
  autoLockMin: number
  entries: SecFileEntry[]
}

export type ProgressFn = (pct: number) => void
export type CancelFn = () => boolean

/* ---------- 密钥与主密码 ---------- */

export function createSecFileVault(password: string, autoLockMin: number): SecFileVault {
  const salt = crypto.randomBytes(16).toString('hex')
  const key = deriveKey(password, salt)
  return {
    version: 1,
    salt,
    verifier: encryptRaw(key, VERIFIER_PLAINTEXT),
    autoLockMin,
    entries: [],
  }
}

export function verifyVaultPassword(vault: SecFileVault, password: string): boolean {
  try {
    const key = deriveKey(password, vault.salt)
    return decryptRaw(key, vault.verifier) === VERIFIER_PLAINTEXT
  } catch {
    return false
  }
}

export function encryptName(key: Buffer, name: string): VaultBlob {
  return encryptRaw(key, name)
}

export function decryptName(key: Buffer, blob: VaultBlob): string {
  return decryptRaw(key, blob)
}

/* ---------- 进度/取消 tap ---------- */

function tapTransform(total: number, onProgress?: ProgressFn, isCancelled?: CancelFn): Transform {
  let done = 0
  return new Transform({
    transform(chunk, _enc, cb) {
      if (isCancelled?.()) return cb(new CancelError())
      done += chunk.length
      if (onProgress && total > 0) onProgress(Math.min(99, Math.floor((done / total) * 100)))
      cb(null, chunk)
    },
  })
}

/* ---------- 文件容器 ---------- */

/** 加密 srcPath → destPath（调用方负责 .tmp 落盘后 rename），返回密文字节数 */
export async function encryptFileTo(
  srcPath: string,
  destPath: string,
  key: Buffer,
  onProgress?: ProgressFn,
  isCancelled?: CancelFn
): Promise<number> {
  const { size } = await fs.stat(srcPath)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ws = createWriteStream(destPath)
  // 头部（magic+iv）先写入（open 前 write 会排队），pipeline 续写密文并在结束后关闭 ws
  ws.write(Buffer.concat([Buffer.from(CONTAINER_MAGIC, 'latin1'), iv]))
  await pipeline(createReadStream(srcPath), cipher, tapTransform(size, onProgress, isCancelled), ws)
  // pipeline 结束后 ws 已关闭，cipher 也已 final，tag 此时才可得：追加到容器尾部
  await fs.appendFile(destPath, cipher.getAuthTag())
  return size + CONTAINER_OVERHEAD
}

/** 解密容器 → destPath；错密钥/篡改在 final 校验 tag 时抛错 */
export async function decryptFileTo(
  srcPath: string,
  destPath: string,
  key: Buffer,
  onProgress?: ProgressFn,
  isCancelled?: CancelFn
): Promise<void> {
  const { plainLen, iv } = await readContainerHeader(srcPath)
  const { tag } = await readContainerTag(srcPath, plainLen)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  if (plainLen === 0) {
    // 空明文：流区间 start>end 会越界，直接 final 校验 tag 后落空文件
    decipher.final()
    await fs.writeFile(destPath, '')
    onProgress?.(100)
    return
  }
  await pipeline(
    createReadStream(srcPath, { start: HEADER_LEN, end: HEADER_LEN + plainLen - 1 }),
    decipher,
    tapTransform(plainLen, onProgress, isCancelled),
    createWriteStream(destPath)
  )
}

/** 解密容器 → 内存（预览用）；超过 maxBytes 拒绝 */
export async function decryptFileToBuffer(
  srcPath: string,
  key: Buffer,
  maxBytes = PREVIEW_MAX_BYTES
): Promise<Buffer> {
  const { plainLen, iv } = await readContainerHeader(srcPath)
  if (plainLen > maxBytes) throw new Error(`文件超过预览上限 ${Math.round(maxBytes / 1024 / 1024)}MB，请导出后打开`)
  const { tag } = await readContainerTag(srcPath, plainLen)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const chunks: Buffer[] = []
  if (plainLen > 0) {
    for await (const c of createReadStream(srcPath, { start: HEADER_LEN, end: HEADER_LEN + plainLen - 1 })) {
      chunks.push(decipher.update(c as Buffer))
    }
  }
  chunks.push(decipher.final())
  return Buffer.concat(chunks)
}

async function readContainerHeader(srcPath: string): Promise<{ plainLen: number; iv: Buffer }> {
  const st = await fs.stat(srcPath)
  if (st.size < CONTAINER_OVERHEAD) throw new Error('容器文件损坏')
  const fd = await fs.open(srcPath, 'r')
  try {
    const head = Buffer.alloc(HEADER_LEN)
    await fd.read(head, 0, HEADER_LEN, 0)
    if (head.subarray(0, 8).toString('latin1') !== CONTAINER_MAGIC) throw new Error('不是文件保险柜容器')
    return { plainLen: st.size - CONTAINER_OVERHEAD, iv: head.subarray(8, HEADER_LEN) }
  } finally {
    await fd.close()
  }
}

async function readContainerTag(srcPath: string, plainLen: number): Promise<{ tag: Buffer }> {
  const fd = await fs.open(srcPath, 'r')
  try {
    const tag = Buffer.alloc(TAG_LEN)
    await fd.read(tag, 0, TAG_LEN, HEADER_LEN + plainLen)
    return { tag }
  } finally {
    await fd.close()
  }
}

/* ---------- vault.json 存取 ---------- */

export async function loadSecFileVault(filePath: string): Promise<SecFileVault | null> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as SecFileVault
    if (parsed.version !== 1 || typeof parsed.salt !== 'string' || !parsed.verifier) return null
    if (!Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

export async function saveSecFileVault(filePath: string, vault: SecFileVault): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(vault, null, 2), { encoding: 'utf8', mode: 0o600 })
}

/* ---------- 整库迁移 bundle ---------- */

interface BundleManifest {
  version: 1
  salt: string
  verifier: VaultBlob
  autoLockMin: number
  entries: Array<SecFileEntry & { offset: number; length: number }>
}

const BUNDLE_BASE = BUNDLE_MAGIC.length + 4 // magic + manifestLen 前缀

/**
 * 导出整库到单个 .wbvault 文件。布局：magic(8) | manifestLen(4 LE) | 各容器顺序拼接 | manifest JSON
 * （manifest 放尾部：容器偏移只依赖容器自身尺寸，不依赖 manifest 长度，避免 JSON 数字位宽循环依赖）
 */
export async function exportVaultBundle(
  vaultDir: string,
  vault: SecFileVault,
  destPath: string,
  onProgress?: ProgressFn,
  isCancelled?: CancelFn
): Promise<void> {
  const containerSizes: number[] = []
  for (const e of vault.entries) {
    const st = await fs.stat(path.join(vaultDir, 'files', `${e.id}.bin`))
    containerSizes.push(st.size)
  }
  let cursor = BUNDLE_BASE
  const entries = vault.entries.map((e, i) => {
    const offset = cursor
    cursor += containerSizes[i]
    return { ...e, offset, length: containerSizes[i] }
  })
  const manifest: BundleManifest = {
    version: 1,
    salt: vault.salt,
    verifier: vault.verifier,
    autoLockMin: vault.autoLockMin,
    entries,
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf8')
  const total = cursor + manifestBuf.length
  const fd = await fs.open(destPath, 'w')
  try {
    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32LE(manifestBuf.length)
    await fd.write(Buffer.concat([Buffer.from(BUNDLE_MAGIC, 'latin1'), lenBuf]))
    let written = BUNDLE_BASE
    for (let i = 0; i < vault.entries.length; i++) {
      const src = path.join(vaultDir, 'files', `${vault.entries[i].id}.bin`)
      for await (const chunk of createReadStream(src)) {
        if (isCancelled?.()) throw new CancelError()
        await fd.write(chunk as Buffer, undefined, undefined, written)
        written += (chunk as Buffer).length
        if (onProgress && total > 0) onProgress(Math.min(99, Math.floor((written / total) * 100)))
      }
    }
    await fd.write(manifestBuf, undefined, undefined, written)
    if (onProgress) onProgress(100)
  } finally {
    await fd.close()
  }
}

/** 导入 bundle 到目标目录（先验主密码，再逐容器校验 magic 落盘） */
export async function importVaultBundle(
  bundlePath: string,
  destDir: string,
  password: string
): Promise<{ count: number; autoLockMin: number }> {
  const st = await fs.stat(bundlePath)
  const fd = await fs.open(bundlePath, 'r')
  let manifest: BundleManifest
  let containerEnd: number
  try {
    const magic = Buffer.alloc(BUNDLE_MAGIC.length)
    await fd.read(magic, 0, magic.length, 0)
    if (magic.toString('latin1') !== BUNDLE_MAGIC) throw new Error('不是保险柜迁移文件')
    const lenBuf = Buffer.alloc(4)
    await fd.read(lenBuf, 0, 4, magic.length)
    const manifestLen = lenBuf.readUInt32LE(0)
    if (BUNDLE_BASE + manifestLen > st.size) throw new Error('迁移文件损坏')
    containerEnd = st.size - manifestLen
    const manifestBuf = Buffer.alloc(manifestLen)
    await fd.read(manifestBuf, 0, manifestLen, containerEnd)
    manifest = JSON.parse(manifestBuf.toString('utf8')) as BundleManifest
    if (manifest.version !== 1 || !manifest.salt || !manifest.verifier || !Array.isArray(manifest.entries)) {
      throw new Error('迁移文件损坏')
    }
  } finally {
    await fd.close()
  }
  const key = deriveKey(password, manifest.salt)
  try {
    if (decryptRaw(key, manifest.verifier) !== VERIFIER_PLAINTEXT) throw new Error('bad')
  } catch {
    throw new Error('主密码错误')
  }
  await fs.mkdir(path.join(destDir, 'files'), { recursive: true })
  const entries: SecFileEntry[] = []
  for (const e of manifest.entries) {
    if (e.offset < BUNDLE_BASE || e.length <= 0 || e.offset + e.length > containerEnd) throw new Error('迁移文件损坏')
    const dest = path.join(destDir, 'files', `${e.id}.bin`)
    await pipeline(createReadStream(bundlePath, { start: e.offset, end: e.offset + e.length - 1 }), createWriteStream(dest))
    await readContainerHeader(dest) // 校验 magic 与尺寸下限
    entries.push({ id: e.id, size: e.size, addedAt: e.addedAt, nameBlob: e.nameBlob })
  }
  const vault: SecFileVault = {
    version: 1,
    salt: manifest.salt,
    verifier: manifest.verifier,
    autoLockMin: manifest.autoLockMin,
    entries,
  }
  await saveSecFileVault(path.join(destDir, 'vault.json'), vault)
  return { count: entries.length, autoLockMin: manifest.autoLockMin }
}
