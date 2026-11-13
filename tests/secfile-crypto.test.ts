// 文件保险柜加密核心测试：容器流式往返、篡改/错钥检测、文件名 blob、
// vault.json 读写、整库 bundle 导出导入往返。纯 Node，真实临时文件。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  createSecFileVault,
  verifyVaultPassword,
  encryptName,
  decryptName,
  encryptFileTo,
  decryptFileTo,
  decryptFileToBuffer,
  loadSecFileVault,
  saveSecFileVault,
  exportVaultBundle,
  importVaultBundle,
  CONTAINER_OVERHEAD,
  CancelError,
} from '../electron/ipc/secfile-crypto'
import { deriveKey } from '../electron/ipc/secvault-crypto'

let dir: string
const PW = 'correct horse battery staple'

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secfile-test-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function keyFor(vault: ReturnType<typeof createSecFileVault>) {
  return deriveKey(PW, vault.salt)
}

async function makeSource(name: string, content: Buffer | string): Promise<string> {
  const p = path.join(dir, name)
  await fs.writeFile(p, content)
  return p
}

describe('容器加解密往返', () => {
  it('小文件往返一致，容器大小=明文+开销', async () => {
    const vault = createSecFileVault(PW, 5)
    const key = keyFor(vault)
    const src = await makeSource('a.txt', 'hello 保险柜')
    const dest = path.join(dir, 'a.bin')
    const cipherLen = await encryptFileTo(src, dest, key)
    expect(cipherLen).toBe(Buffer.byteLength('hello 保险柜') + CONTAINER_OVERHEAD)
    const out = path.join(dir, 'a.out')
    await decryptFileTo(dest, out, key)
    expect(await fs.readFile(out, 'utf8')).toBe('hello 保险柜')
  })

  it('空文件往返', async () => {
    const key = keyFor(createSecFileVault(PW, 5))
    const src = await makeSource('empty.bin', '')
    const dest = path.join(dir, 'empty.c.bin')
    await encryptFileTo(src, dest, key)
    const out = path.join(dir, 'empty.out')
    await decryptFileTo(dest, out, key)
    expect((await fs.stat(out)).size).toBe(0)
  })

  it('较大文件（1MB）流式往返字节一致', async () => {
    const key = keyFor(createSecFileVault(PW, 5))
    const big = crypto.randomBytes(1024 * 1024)
    const src = await makeSource('big.bin', big)
    const dest = path.join(dir, 'big.c.bin')
    await encryptFileTo(src, dest, key)
    const out = path.join(dir, 'big.out')
    await decryptFileTo(dest, out, key)
    expect(await fs.readFile(out)).toEqual(big)
  }, 30_000)

  it('错钥解密抛认证错误', async () => {
    const key = keyFor(createSecFileVault(PW, 5))
    const src = await makeSource('x.txt', 'secret')
    const dest = path.join(dir, 'x.c.bin')
    await encryptFileTo(src, dest, key)
    const wrongKey = deriveKey('wrong password', '00'.repeat(16))
    await expect(decryptFileTo(dest, path.join(dir, 'x.out'), wrongKey)).rejects.toThrow()
  })

  it('密文被篡改（改中间一字节）解密失败', async () => {
    const key = keyFor(createSecFileVault(PW, 5))
    const src = await makeSource('t.txt', 'tamper me')
    const dest = path.join(dir, 't.c.bin')
    await encryptFileTo(src, dest, key)
    const buf = await fs.readFile(dest)
    buf[CONTAINER_OVERHEAD - 16 + 2] ^= 0xff // 改密文区第一字节（iv 之后）
    await fs.writeFile(dest, buf)
    await expect(decryptFileTo(dest, path.join(dir, 't.out'), key)).rejects.toThrow()
  })

  it('非容器文件（magic 不符）拒绝解密', async () => {
    const key = keyFor(createSecFileVault(PW, 5))
    const fake = await makeSource('fake.bin', 'x'.repeat(100))
    await expect(decryptFileTo(fake, path.join(dir, 'o'), key)).rejects.toThrow(/容器/)
  })

  it('预览 buffer 超上限拒绝', async () => {
    const key = keyFor(createSecFileVault(PW, 5))
    const src = await makeSource('p.bin', crypto.randomBytes(2048))
    const dest = path.join(dir, 'p.c.bin')
    await encryptFileTo(src, dest, key)
    await expect(decryptFileToBuffer(dest, key, 1024)).rejects.toThrow(/预览上限/)
    const buf = await decryptFileToBuffer(dest, key, 4096)
    expect(buf.length).toBe(2048)
  })

  it('取消在流 tap 中抛 CancelError', async () => {
    const key = keyFor(createSecFileVault(PW, 5))
    const src = await makeSource('c.bin', crypto.randomBytes(4096))
    const dest = path.join(dir, 'c.c.bin')
    await expect(encryptFileTo(src, dest, key, undefined, () => true)).rejects.toBeInstanceOf(CancelError)
  })
})

describe('主密码与文件名 blob', () => {
  it('正确/错误主密码验证', () => {
    const vault = createSecFileVault(PW, 5)
    expect(verifyVaultPassword(vault, PW)).toBe(true)
    expect(verifyVaultPassword(vault, PW + '!')).toBe(false)
  })

  it('文件名加解密往返（含中文与特殊字符）', () => {
    const key = keyFor(createSecFileVault(PW, 5))
    const name = '工资表 2026#final.xlsx'
    expect(decryptName(key, encryptName(key, name))).toBe(name)
  })
})

describe('vault.json 读写', () => {
  it('损坏 JSON 返回 null；合法往返', async () => {
    const p = path.join(dir, 'vault.json')
    await fs.writeFile(p, '{not json')
    expect(await loadSecFileVault(p)).toBeNull()
    const vault = createSecFileVault(PW, 7)
    await saveSecFileVault(p, vault)
    const loaded = await loadSecFileVault(p)
    expect(loaded?.autoLockMin).toBe(7)
    expect(loaded?.entries).toEqual([])
  })

  it('不存在的文件返回 null', async () => {
    expect(await loadSecFileVault(path.join(dir, 'missing.json'))).toBeNull()
  })
})

describe('整库 bundle 导出导入', () => {
  async function buildVault() {
    const vault = createSecFileVault(PW, 5)
    const key = keyFor(vault)
    await fs.mkdir(path.join(dir, 'files'), { recursive: true })
    for (const [name, content] of [['f1.txt', 'one'], ['f2.txt', 'two']]) {
      const id = crypto.randomUUID()
      const src = await makeSource(name, content)
      await encryptFileTo(src, path.join(dir, 'files', `${id}.bin`), key)
      vault.entries.push({ id, size: Buffer.byteLength(content), addedAt: new Date().toISOString(), nameBlob: encryptName(key, name) })
    }
    return { vault, key }
  }

  it('导出→用正确密码导入：条目/文件名/内容完整还原', async () => {
    const { vault } = await buildVault()
    const bundle = path.join(dir, 'out.wbvault')
    const pcts: number[] = []
    await exportVaultBundle(dir, vault, bundle, (p) => pcts.push(p))
    expect(pcts.length).toBeGreaterThan(0)
    const destDir = path.join(dir, 'restored')
    const r = await importVaultBundle(bundle, destDir, PW)
    expect(r.count).toBe(2)
    expect(r.autoLockMin).toBe(5)
    const restored = await loadSecFileVault(path.join(destDir, 'vault.json'))
    expect(restored!.entries.length).toBe(2)
    const key = deriveKey(PW, restored!.salt)
    const e0 = restored!.entries[0]
    expect(decryptName(key, e0.nameBlob)).toBe('f1.txt')
    const out = path.join(dir, 'f1.out')
    await decryptFileTo(path.join(destDir, 'files', `${e0.id}.bin`), out, key)
    expect(await fs.readFile(out, 'utf8')).toBe('one')
  })

  it('错误密码导入拒绝且不落盘', async () => {
    const { vault } = await buildVault()
    const bundle = path.join(dir, 'bad.wbvault')
    await exportVaultBundle(dir, vault, bundle)
    const destDir = path.join(dir, 'never')
    await expect(importVaultBundle(bundle, destDir, 'wrong')).rejects.toThrow(/主密码错误/)
    expect(await fs.stat(destDir).then(() => true, () => false)).toBe(false)
  })

  it('非 bundle 文件拒绝导入', async () => {
    const junk = await makeSource('junk.bin', 'x'.repeat(64))
    await expect(importVaultBundle(junk, path.join(dir, 'd'), PW)).rejects.toThrow(/迁移文件/)
  })
})
