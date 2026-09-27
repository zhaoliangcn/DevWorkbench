// 附录 B.7：凭据保险库加密与文件存取测试（node:crypto 纯函数）
import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  createVaultFile,
  decryptEntryValue,
  encryptEntryValue,
  isPasswordValid,
  loadVaultFile,
  saveVaultFile,
  verifyMasterPassword,
} from '../electron/ipc/secvault-crypto'
import type { VaultEntryStored } from '../electron/ipc/secvault-crypto'

const PW = 'correct-horse-battery'
const WRONG = 'wrong-password'

function makeEntry(file: ReturnType<typeof createVaultFile>, value: string): VaultEntryStored {
  return {
    id: randomUUID(),
    name: 'test-entry',
    kind: 'other',
    createdAt: '2026-09-27T00:00:00.000Z',
    blob: encryptEntryValue(file, PW, value),
  }
}

describe('isPasswordValid（B.7）', () => {
  it('至少 8 位', () => {
    expect(isPasswordValid('12345678')).toBe(true)
    expect(isPasswordValid('1234567')).toBe(false)
    expect(isPasswordValid('')).toBe(false)
  })
})

describe('主密码验证（B.7）', () => {
  it('正确密码通过，错误密码拒绝', () => {
    const file = createVaultFile(PW)
    expect(verifyMasterPassword(file, PW)).toBe(true)
    expect(verifyMasterPassword(file, WRONG)).toBe(false)
  })

  it('每次创建盐不同，文件结构不可复用', () => {
    expect(createVaultFile(PW).salt).not.toBe(createVaultFile(PW).salt)
  })
})

describe('凭据加解密（B.7）', () => {
  it('往返：明文（含多行 SSH 私钥）原样恢复', () => {
    const file = createVaultFile(PW)
    const privateKey = ['-----BEGIN OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXk=', '-----END OPENSSH PRIVATE KEY-----'].join('\n')
    for (const plain of ['simple-token', privateKey, '']) {
      const entry = makeEntry(file, plain)
      expect(decryptEntryValue(file, PW, entry)).toBe(plain)
    }
  })

  it('错误密码解密抛错（GCM 认证失败）', () => {
    const file = createVaultFile(PW)
    const entry = makeEntry(file, 'secret')
    expect(() => decryptEntryValue(file, WRONG, entry)).toThrow()
  })

  it('密文被篡改（data 位翻转）解密抛错', () => {
    const file = createVaultFile(PW)
    const entry = makeEntry(file, 'secret')
    const tampered: VaultEntryStored = {
      ...entry,
      blob: { ...entry.blob, data: 'ff' + entry.blob.data.slice(2) },
    }
    expect(() => decryptEntryValue(file, PW, tampered)).toThrow()
  })

  it('同一明文两次加密 IV 不同，密文不同', () => {
    const file = createVaultFile(PW)
    const a = encryptEntryValue(file, PW, 'same')
    const b = encryptEntryValue(file, PW, 'same')
    expect(a.iv).not.toBe(b.iv)
    expect(a.data).not.toBe(b.data)
    expect(a.tag).not.toBe(b.tag)
  })
})

describe('文件存取（B.7）', () => {
  it('save → load 往返一致；不存在/损坏返回 null', async () => {
    const dir = path.join(tmpdir(), `wb-secvault-test-${Date.now()}`)
    const filePath = path.join(dir, 'credentials-vault.json')
    const file = createVaultFile(PW)
    file.entries.push(makeEntry(file, 'db-url'))
    await saveVaultFile(filePath, file)

    const loaded = await loadVaultFile(filePath)
    expect(loaded).not.toBeNull()
    expect(loaded!.salt).toBe(file.salt)
    expect(loaded!.entries).toHaveLength(1)
    expect(decryptEntryValue(loaded!, PW, loaded!.entries[0])).toBe('db-url')
    expect(verifyMasterPassword(loaded!, WRONG)).toBe(false)

    expect(await loadVaultFile(path.join(dir, 'missing.json'))).toBeNull()

    const brokenPath = path.join(dir, 'broken.json')
    await saveVaultFile(brokenPath, file)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(brokenPath, '{not json', 'utf8')
    expect(await loadVaultFile(brokenPath)).toBeNull()
  })
})
