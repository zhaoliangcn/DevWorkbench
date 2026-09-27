/**
 * 凭据保险库加密与文件存取（附录 B.7）。
 * 设计原文建议 crypto-js，但该库无认证加密且已停维护——改用 Node 内置 crypto：
 * - 主密码 → scrypt(N=16384, r=8, p=1) 派生 256 位密钥（每文件 16 字节随机盐）
 * - 每条凭据 AES-256-GCM 认证加密（随机 12 字节 IV + 16 字节 authTag），篡改/错密码解密即抛错
 * - 元数据（名称/kind/时间）明文存储以便列表展示；值与 verifier 密文 hex 编码
 * - 文件结构带 version 字段，为未来轮换留余地；unix 下落盘 chmod 600
 * 纯函数 + 注入式文件路径，vitest node 环境可直接测。
 */
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface VaultBlob {
  iv: string
  tag: string
  data: string
}

export interface VaultEntryStored {
  id: string
  name: string
  kind: 'ssh' | 'http' | 'db' | 'other'
  createdAt: string
  blob: VaultBlob
}

export interface VaultFile {
  version: 1
  salt: string
  verifier: VaultBlob
  entries: VaultEntryStored[]
}

const VERIFIER_PLAINTEXT = 'wb-vault-verifier-v1'
const MIN_PASSWORD_LEN = 8

export function isPasswordValid(password: string): boolean {
  return password.length >= MIN_PASSWORD_LEN
}

function deriveKey(password: string, saltHex: string): Buffer {
  return crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 })
}

function encryptRaw(key: Buffer, plaintext: string): VaultBlob {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  }
}

function decryptRaw(key: Buffer, blob: VaultBlob): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'))
  decipher.setAuthTag(Buffer.from(blob.tag, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(blob.data, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

/** 新建保险库文件结构（盐 + verifier），不落盘 */
export function createVaultFile(password: string): VaultFile {
  const salt = crypto.randomBytes(16).toString('hex')
  const key = deriveKey(password, salt)
  return {
    version: 1,
    salt,
    verifier: encryptRaw(key, VERIFIER_PLAINTEXT),
    entries: [],
  }
}

/** 校验主密码（解 verifier，GCM 认证失败/明文不符均视为错误） */
export function verifyMasterPassword(file: VaultFile, password: string): boolean {
  try {
    const key = deriveKey(password, file.salt)
    return decryptRaw(key, file.verifier) === VERIFIER_PLAINTEXT
  } catch {
    return false
  }
}

/** 加密一条凭据值（供 put 写入 blob） */
export function encryptEntryValue(file: VaultFile, password: string, value: string): VaultBlob {
  const key = deriveKey(password, file.salt)
  return encryptRaw(key, value)
}

/** 解密一条凭据值；错误密码或数据被篡改时抛 Error */
export function decryptEntryValue(
  file: VaultFile,
  password: string,
  entry: VaultEntryStored
): string {
  const key = deriveKey(password, file.salt)
  return decryptRaw(key, entry.blob)
}

/** 读取保险库文件；不存在或 JSON 损坏返回 null */
export async function loadVaultFile(filePath: string): Promise<VaultFile | null> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as VaultFile
    if (parsed.version !== 1 || typeof parsed.salt !== 'string' || !parsed.verifier) return null
    if (!Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

/** 写入保险库文件（自动建父目录）；unix 下收紧权限为 600 */
export async function saveVaultFile(filePath: string, file: VaultFile): Promise<void> {
  const json = JSON.stringify(file, null, 2)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, json, { encoding: 'utf8', mode: 0o600 })
}
