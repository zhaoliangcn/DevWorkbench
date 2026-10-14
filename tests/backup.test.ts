// 文件夹备份测试：通配符匹配 / 排除清单清洗 / 名称校验 / 临时目录遍历与复制 / 路径安全
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, dialog: {}, BrowserWindow: {} }))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  wildcardToRegExp,
  createBackupMatcher,
  sanitizeExcludes,
  validateBackupName,
  defaultBackupName,
  walkSource,
  copyFiles,
  resolveSafeDest,
  crc32,
  writeZip,
} from '../electron/ipc/backup.js'

describe('wildcardToRegExp', () => {
  const match = (pattern: string, s: string) => wildcardToRegExp(pattern)?.test(s) ?? false

  it('* 匹配段内任意字符', () => {
    expect(match('*.log', 'a.log')).toBe(true)
    expect(match('*.log', 'A.LOG')).toBe(true)
    expect(match('*.log', 'logs/a.log')).toBe(false)
    expect(match('temp*', 'temp123')).toBe(true)
    expect(match('temp*', 'mytemp')).toBe(false)
  })

  it('? 匹配单个字符', () => {
    expect(match('a?c', 'abc')).toBe(true)
    expect(match('a?c', 'ac')).toBe(false)
    expect(match('a?c', 'abbc')).toBe(false)
  })

  it('** 跨目录段', () => {
    expect(match('src/**', 'src/a.js')).toBe(true)
    expect(match('src/**', 'src/x/y.js')).toBe(true)
    expect(match('src/**', 'srcx')).toBe(false)
    expect(match('**/test.js', 'test.js')).toBe(true)
    expect(match('**/test.js', 'a/b/test.js')).toBe(true)
    expect(match('**/test.js', 'a/b/test.ts')).toBe(false)
  })

  it('正则元字符按字面匹配，输入兼容反斜杠，空模式返回 null', () => {
    expect(match('a+b.txt', 'a+b.txt')).toBe(true)
    expect(match('a+b.txt', 'aab.txt')).toBe(false)
    expect(match('src\\temp', 'src/temp')).toBe(true)
    expect(wildcardToRegExp('   ')).toBeNull()
  })
})

describe('createBackupMatcher', () => {
  const matcher = (ex: Parameters<typeof createBackupMatcher>[0]) => createBackupMatcher(ex)

  it('精确文件名仅对文件生效', () => {
    const m = matcher({ files: ['secret.key'], dirs: [], patterns: [] })
    expect(m.isExcluded('a/secret.key', 'file')).toBe(true)
    expect(m.isExcluded('a/secret.key', 'dir')).toBe(false)
    expect(m.isExcluded('a/other.key', 'file')).toBe(false)
  })

  it('精确目录名仅对目录生效且大小写不敏感', () => {
    const m = matcher({ files: [], dirs: ['node_modules'], patterns: [] })
    expect(m.isExcluded('x/node_modules', 'dir')).toBe(true)
    expect(m.isExcluded('x/Node_Modules', 'dir')).toBe(true)
    expect(m.isExcluded('x/node_modules', 'file')).toBe(false)
  })

  it('通配符对文件与目录均生效；含 / 时按相对路径匹配', () => {
    const m = matcher({ files: [], dirs: [], patterns: ['*.log', 'assets/*.png'] })
    expect(m.isExcluded('a/b/debug.log', 'file')).toBe(true)
    expect(m.isExcluded('cache.log', 'dir')).toBe(true)
    expect(m.isExcluded('assets/logo.png', 'file')).toBe(true)
    expect(m.isExcluded('deep/assets/logo.png', 'file')).toBe(false)
    expect(m.isExcluded('assets/logo.jpg', 'file')).toBe(false)
  })

  it('含 / 的精确名按相对路径匹配', () => {
    const m = matcher({ files: ['docs/draft.md'], dirs: ['a/b'], patterns: [] })
    expect(m.isExcluded('docs/draft.md', 'file')).toBe(true)
    expect(m.isExcluded('other/docs/draft.md', 'file')).toBe(false)
    expect(m.isExcluded('a/b', 'dir')).toBe(true)
  })

  it('非法通配符被忽略，不影响其余规则', () => {
    const m = matcher({ files: [], dirs: [], patterns: ['[a-', '*.tmp'] })
    expect(m.isExcluded('x.tmp', 'file')).toBe(true)
    expect(m.isExcluded('y.log', 'file')).toBe(false)
  })
})

describe('sanitizeExcludes', () => {
  it('非数组输入归零、逐条 trim 去空', () => {
    expect(sanitizeExcludes(null)).toEqual({ files: [], dirs: [], patterns: [] })
    expect(sanitizeExcludes({ files: 'x', dirs: ['  a  ', '', 5], patterns: ['*.log'] })).toEqual({
      files: [],
      dirs: ['a'],
      patterns: ['*.log'],
    })
  })

  it('截断超量（200 条）与超长（200 字符）', () => {
    const many = Array.from({ length: 300 }, (_, i) => `f${i}`)
    const long = 'x'.repeat(500)
    const out = sanitizeExcludes({ files: many, dirs: [long], patterns: [] })
    expect(out.files).toHaveLength(200)
    expect(out.files[199]).toBe('f199')
    expect(out.dirs[0]).toHaveLength(200)
  })
})

describe('validateBackupName', () => {
  it('合法名称返回 null', () => {
    expect(validateBackupName('my backup-2026')).toBeNull()
    expect(validateBackupName('项目备份_1.0')).toBeNull()
  })

  it('拒绝空名/路径分隔符/非法字符/点空格结尾/保留名', () => {
    expect(validateBackupName('')).not.toBeNull()
    expect(validateBackupName('a/b')).not.toBeNull()
    expect(validateBackupName('a\\b')).not.toBeNull()
    expect(validateBackupName('a:b')).not.toBeNull()
    expect(validateBackupName('a*b')).not.toBeNull()
    expect(validateBackupName('.hidden')).not.toBeNull()
    expect(validateBackupName('a.')).not.toBeNull()
    expect(validateBackupName('a ')).toBeNull() // 尾随空格被 trim，属合法输入
    expect(validateBackupName('con')).not.toBeNull()
    expect(validateBackupName('CON.txt')).not.toBeNull()
    expect(validateBackupName('x'.repeat(101))).not.toBeNull()
  })
})

describe('defaultBackupName', () => {
  it('格式为 源名-backup-YYYYMMDD-HHmmss，非法字符替换为 _', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5)
    expect(defaultBackupName('myproj', d)).toBe('myproj-backup-20260102-030405')
    expect(defaultBackupName('a:b*c', d)).toBe('a_b_c-backup-20260102-030405')
    expect(defaultBackupName('', d)).toBe('backup-backup-20260102-030405')
  })
})

describe('walkSource + copyFiles（临时目录集成）', () => {
  it('按排除规则遍历并复制', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-backup-src-'))
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-backup-dst-'))
    try {
      fs.writeFileSync(path.join(src, 'a.txt'), 'aaa')
      fs.writeFileSync(path.join(src, 'skip.log'), 'log')
      fs.mkdirSync(path.join(src, 'sub'))
      fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'bbb')
      fs.writeFileSync(path.join(src, 'sub', 'skip.log'), 'log2')
      fs.mkdirSync(path.join(src, 'node_modules'))
      fs.writeFileSync(path.join(src, 'node_modules', 'x.js'), 'xxx')
      fs.mkdirSync(path.join(src, 'empty-dir'))

      const matcher = createBackupMatcher({
        files: [],
        dirs: ['node_modules'],
        patterns: ['*.log'],
      })
      const seen: string[] = []
      const scan = await walkSource(src, matcher, (rel) => seen.push(rel))
      expect(scan.files.map((f) => f.rel).sort()).toEqual(['a.txt', 'sub/b.txt'])
      expect(scan.skippedFiles).toBe(2)
      expect(scan.skippedDirs).toBe(1) // node_modules（empty-dir 保留为空目录）

      const outcome = await copyFiles(scan.files, dest, () => {}, () => false)
      expect(outcome.copied).toBe(2)
      expect(outcome.canceled).toBe(false)
      expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('aaa')
      expect(fs.readFileSync(path.join(dest, 'sub', 'b.txt'), 'utf8')).toBe('bbb')
      expect(fs.existsSync(path.join(dest, 'node_modules'))).toBe(false)

      // 取消：一个都不复制
      const canceled = await copyFiles(scan.files, dest, () => {}, () => true)
      expect(canceled.canceled).toBe(true)
      expect(canceled.copied).toBe(0)
    } finally {
      fs.rmSync(src, { recursive: true, force: true })
      fs.rmSync(dest, { recursive: true, force: true })
    }
  })
})

describe('resolveSafeDest', () => {
  const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wb-backup-safe-'))

  it('合法 dest 位于 targetDir 内', () => {
    const target = mk()
    try {
      const dest = resolveSafeDest(target, 'bk', path.join(target, 'src'))
      expect(path.resolve(dest)).toBe(path.resolve(target, 'bk'))
    } finally {
      fs.rmSync(target, { recursive: true, force: true })
    }
  })

  it('拒绝越界与源/目标重叠', () => {
    const parent = mk()
    const source = path.join(parent, 'sub')
    fs.mkdirSync(source)
    try {
      // dest 越出 targetDir
      expect(() => resolveSafeDest(parent, '..', source)).toThrow()
      // dest 等于源目录
      expect(() => resolveSafeDest(parent, 'sub', source)).toThrow(/重叠/)
      // dest 位于源目录内
      expect(() => resolveSafeDest(source, 'inner', source)).toThrow(/重叠/)
      // dest 是源的祖先（source 在 dest 内）
      const outer = path.dirname(parent)
      expect(() => resolveSafeDest(outer, path.basename(parent), source)).toThrow(/重叠/)
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('crc32', () => {
  it('标准测试向量', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })
})

describe('writeZip', () => {
  /** 最小 zip 读取器：解析 EOCD + 中央目录，按条目解出原文 */
  function readZipEntries(buf: Buffer) {
    let eocdOff = buf.length - 22
    while (eocdOff >= 0 && buf.readUInt32LE(eocdOff) !== 0x06054b50) eocdOff--
    expect(eocdOff).toBeGreaterThanOrEqual(0)
    const count = buf.readUInt16LE(eocdOff + 10)
    const cdOff = buf.readUInt32LE(eocdOff + 16)
    const entries = new Map<string, { method: number; crc: number; csize: number; usize: number; offset: number }>()
    let p = cdOff
    for (let i = 0; i < count; i++) {
      expect(buf.readUInt32LE(p)).toBe(0x02014b50)
      const nameLen = buf.readUInt16LE(p + 28)
      entries.set(buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'), {
        method: buf.readUInt16LE(p + 10),
        crc: buf.readUInt32LE(p + 16),
        csize: buf.readUInt32LE(p + 20),
        usize: buf.readUInt32LE(p + 24),
        offset: buf.readUInt32LE(p + 42),
      })
      p += 46 + nameLen
    }
    const extract = (name: string): Buffer => {
      const e = entries.get(name)
      if (!e) throw new Error(`zip 内缺少条目 ${name}`)
      const nameLen = buf.readUInt16LE(e.offset + 26)
      const extraLen = buf.readUInt16LE(e.offset + 28)
      const dataStart = e.offset + 30 + nameLen + extraLen
      const data = buf.subarray(dataStart, dataStart + e.csize)
      return e.method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data)
    }
    return { entries, extract }
  }

  it('打包后可解出原文件（DEFLATE 与大文件 STORE 混合）', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-zip-src-'))
    try {
      const textFile = path.join(src, 'a.txt')
      fs.writeFileSync(textFile, 'hello zip world '.repeat(200))
      fs.mkdirSync(path.join(src, 'sub'))
      const subFile = path.join(src, 'sub', 'b.txt')
      fs.writeFileSync(subFile, 'bbb')
      // 不可压随机数据，超过测试阈值走 STORE
      const bigFile = path.join(src, 'big.bin')
      fs.writeFileSync(bigFile, Buffer.from({ length: 200_000 }, () => Math.floor(Math.random() * 256)))

      const entries = [textFile, subFile, bigFile].map((abs) => ({
        name: path.relative(src, abs).replace(/\\/g, '/'),
        abs,
        size: fs.statSync(abs).size,
      }))
      const out = path.join(src, 'out.zip')
      const progress: number[] = []
      const r = await writeZip(out, entries, (d) => progress.push(d), () => false, 64 * 1024)
      expect(r.canceled).toBe(false)
      if (r.canceled) return
      expect(r.files).toBe(3)
      expect(progress).toHaveLength(3)

      const { entries: found, extract } = readZipEntries(fs.readFileSync(out))
      expect(extract('a.txt').toString('utf8')).toBe(fs.readFileSync(textFile, 'utf8'))
      expect(extract('sub/b.txt')).toEqual(fs.readFileSync(subFile))
      expect(extract('big.bin')).toEqual(fs.readFileSync(bigFile))
      expect(found.get('a.txt')?.method).toBe(8) // 可压文本走 DEFLATE
      expect(found.get('big.bin')?.method).toBe(0) // 超阈值随机数据走 STORE
      expect(found.get('a.txt')?.crc).toBe(crc32(fs.readFileSync(textFile)))
      expect(found.get('big.bin')?.usize).toBe(200_000)
    } finally {
      fs.rmSync(src, { recursive: true, force: true })
    }
  })

  it('取消时返回 canceled', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-zip-cancel-'))
    try {
      const f = path.join(src, 'a.txt')
      fs.writeFileSync(f, 'x'.repeat(1000))
      const r = await writeZip(
        path.join(src, 'out.zip'),
        [{ name: 'a.txt', abs: f, size: 1000 }],
        () => {},
        () => true,
      )
      expect(r.canceled).toBe(true)
    } finally {
      fs.rmSync(src, { recursive: true, force: true })
    }
  })
})
