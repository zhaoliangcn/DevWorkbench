// 工具箱：文件解压纯函数引擎测试（src/workspaces/toolbox/tools/pure/archive.ts）
// 覆盖：格式识别、路径穿越净化、zip/tar/tar.gz/gz 列表与解压、加密/符号链接跳过、
// 同名策略规划、取消与进度回调
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import {
  detectArchiveFormat,
  gunzip,
  inspectArchive,
  planExtraction,
  prepareArchive,
  sanitizeEntryPath,
  uniqueEntryPath,
  extractArchive,
  type ArchiveInspection,
  type ConflictPolicy,
  type ExtractedItem,
} from '../src/workspaces/toolbox/tools/pure/archive'

/* ---------- zip 测试夹具（仅测试用，不依赖引擎自身实现） ---------- */

interface ZipItem {
  name: string
  data?: Uint8Array
  method?: 0 | 8
  encrypted?: boolean
  /** unix 外部属性高 16 位（如 symlink 0o120777） */
  mode?: number
  dosDir?: boolean
}

function u16(value: number): Buffer {
  const buf = Buffer.alloc(2)
  buf.writeUInt16LE(value & 0xffff, 0)
  return buf
}

function u32(value: number): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(value >>> 0, 0)
  return buf
}

function makeZip(items: ZipItem[]): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const item of items) {
    const raw = item.data ?? new Uint8Array(0)
    const method = item.method ?? 0
    const body = method === 8 ? Buffer.from(zlib.deflateRawSync(raw)) : Buffer.from(raw)
    const name = Buffer.from(item.name, 'utf8')
    const flags = (item.encrypted ? 0x1 : 0) | 0x800
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(body.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      name,
      body,
    ])
    const external = (((item.mode ?? 0o100644) << 16) | (item.dosDir ? 0x10 : 0)) >>> 0
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(0x031e),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(body.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(external),
      u32(offset),
      name,
    ])
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const localPart = Buffer.concat(locals)
  const centralPart = Buffer.concat(centrals)
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(items.length),
    u16(items.length),
    u32(centralPart.length),
    u32(localPart.length),
    u16(0),
  ])
  return new Uint8Array(Buffer.concat([localPart, centralPart, eocd]))
}

/* ---------- tar 测试夹具 ---------- */

function tarHeader(name: string, size: number, type = '0', linkname = ''): Buffer {
  const header = Buffer.alloc(512)
  header.write(name.slice(0, 100), 0, 'utf8')
  header.write('0000644\0', 100, 'utf8')
  header.write('0000000\0', 108, 'utf8')
  header.write('0000000\0', 116, 'utf8')
  // tar 数字字段为八进制
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'utf8')
  header.write(`${(0).toString(8).padStart(11, '0')}\0`, 136, 'utf8')
  header.write(type, 156, 'utf8')
  header.write(linkname.slice(0, 100), 157, 'utf8')
  header.write('ustar\0', 257, 'utf8')
  header.write('00', 263, 'utf8')
  // checksum：先按空白计算，再写入 6 位八进制 + NUL + 空格
  header.fill(0x20, 148, 156)
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'utf8')
  return header
}

interface TarItem {
  name: string
  data?: Uint8Array
  type?: string
  linkname?: string
  longName?: string
}

function makeTar(items: TarItem[]): Uint8Array {
  const parts: Buffer[] = []
  for (const item of items) {
    const data = Buffer.from(item.data ?? new Uint8Array(0))
    if (item.longName) {
      const longData = Buffer.from(`${item.longName}\0`, 'utf8')
      parts.push(tarHeader('././@LongLink', longData.length, 'L'))
      parts.push(longData)
      parts.push(Buffer.alloc((512 - (longData.length % 512)) % 512))
    }
    parts.push(tarHeader(item.name, data.length, item.type ?? '0', item.linkname ?? ''))
    if (data.length) {
      parts.push(data)
      parts.push(Buffer.alloc((512 - (data.length % 512)) % 512))
    }
  }
  parts.push(Buffer.alloc(1024))
  return new Uint8Array(Buffer.concat(parts))
}

async function collect(
  bytes: Uint8Array,
  format: 'zip' | 'tar' | 'gz',
  inspection: ArchiveInspection,
  conflict: ConflictPolicy = 'rename',
  platform: 'win32' | 'darwin' | 'linux' = 'linux',
): Promise<{ items: ExtractedItem[]; progress: number[] }> {
  const plan = planExtraction(inspection, { conflict, platform })
  const progress: number[] = []
  const items: ExtractedItem[] = []
  for await (const item of extractArchive(bytes, format, inspection, plan.items, {
    onProgress: (done) => progress.push(done),
  })) {
    items.push(item)
  }
  return { items, progress }
}

describe('detectArchiveFormat', () => {
  it('按扩展名识别受支持格式', () => {
    expect(detectArchiveFormat('a.zip').format).toBe('zip')
    expect(detectArchiveFormat('a.tar').format).toBe('tar')
    expect(detectArchiveFormat('a.tar.gz').format).toBe('tar.gz')
    expect(detectArchiveFormat('a.tgz').format).toBe('tar.gz')
    expect(detectArchiveFormat('a.gz').format).toBe('gz')
  })

  it('rar / 7z 明确标记不支持', () => {
    const rar = detectArchiveFormat('a.rar')
    expect(rar.supported).toBe(false)
    expect(rar.reason).toContain('RAR')
    const seven = detectArchiveFormat('a.7z')
    expect(seven.supported).toBe(false)
    expect(seven.reason).toContain('7z')
  })

  it('魔数优先于扩展名（防改名/无扩展名）', () => {
    const gz = new Uint8Array([0x1f, 0x8b, 0x08, 0x00])
    expect(detectArchiveFormat('no-extension', gz).format).toBe('gz')
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    expect(detectArchiveFormat('data.bin', zip).format).toBe('zip')
  })
})

describe('sanitizeEntryPath', () => {
  it('接受普通相对路径并统一分隔符', () => {
    expect(sanitizeEntryPath('a/b.txt')).toEqual({ ok: true, path: 'a/b.txt' })
    expect(sanitizeEntryPath('./a\\b\\c.txt')).toEqual({ ok: true, path: 'a/b/c.txt' })
  })

  it('拒绝路径穿越与绝对路径', () => {
    expect(sanitizeEntryPath('../evil.txt').ok).toBe(false)
    expect(sanitizeEntryPath('a/../../evil.txt').ok).toBe(false)
    expect(sanitizeEntryPath('/etc/passwd').ok).toBe(false)
    expect(sanitizeEntryPath('C:\\Windows\\x.dll').ok).toBe(false)
    expect(sanitizeEntryPath('\\\\server\\share\\x').ok).toBe(false)
  })

  it('拒绝 Windows 非法字符与保留设备名', () => {
    expect(sanitizeEntryPath('a:b.txt').ok).toBe(false)
    expect(sanitizeEntryPath('a/*.txt').ok).toBe(false)
    expect(sanitizeEntryPath('CON').ok).toBe(false)
    expect(sanitizeEntryPath('dir/name.').ok).toBe(false)
  })
})

describe('uniqueEntryPath', () => {
  it('生成 name (n).ext 并避开占用集合', () => {
    const occupied = new Set(['a.txt', 'a (1).txt'])
    expect(uniqueEntryPath('a.txt', occupied, false)).toBe('a (2).txt')
    expect(uniqueEntryPath('dir/noext', new Set(['dir/noext']), false)).toBe('dir/noext (1)')
  })
})

describe('zip 列表与解压', () => {
  const zip = makeZip([
    { name: 'docs/', data: new Uint8Array(0), mode: 0o040755, dosDir: true },
    { name: 'docs/readme.txt', data: new TextEncoder().encode('hello zip'), method: 8 },
    { name: 'stored.bin', data: new Uint8Array([1, 2, 3, 4]) },
  ])

  it('解析条目、目录与大小', async () => {
    const inspection = await inspectArchive(zip, 'zip')
    expect(inspection.entries.map((e) => e.path)).toEqual(['docs', 'docs/readme.txt', 'stored.bin'])
    expect(inspection.entries[0].kind).toBe('dir')
    expect(inspection.totalFiles).toBe(2)
    expect(inspection.totalBytes).toBe(13)
  })

  it('按规划解压出正确的字节（deflate + store）', async () => {
    const inspection = await inspectArchive(zip, 'zip')
    const { items, progress } = await collect(zip, 'zip', inspection)
    expect(items.map((i) => [i.kind, i.path, i.size])).toEqual([
      ['dir', 'docs', 0],
      ['file', 'docs/readme.txt', 9],
      ['file', 'stored.bin', 4],
    ])
    expect(new TextDecoder().decode(items[1].data)).toBe('hello zip')
    expect([...items[2].data!]).toEqual([1, 2, 3, 4])
    expect(progress[progress.length - 1]).toBe(13)
  })

  it('路径穿越与符号链接被规划跳过', async () => {
    const evil = makeZip([
      { name: '../../evil.txt', data: new TextEncoder().encode('x') },
      { name: '/absolute.txt', data: new TextEncoder().encode('x') },
      { name: 'link', data: new TextEncoder().encode('../../secret'), mode: 0o120777 },
      { name: 'ok.txt', data: new TextEncoder().encode('ok') },
    ])
    const inspection = await inspectArchive(evil, 'zip')
    expect(inspection.unsafeCount).toBe(2)
    expect(inspection.symlinkCount).toBe(1)
    const plan = planExtraction(inspection, { conflict: 'rename', platform: 'linux' })
    expect(plan.items.map((i) => i.targetPath)).toEqual([null, null, null, 'ok.txt'])
    expect(plan.skipped.unsafe).toBe(2)
    expect(plan.skipped.symlink).toBe(1)

    const { items } = await collect(evil, 'zip', inspection)
    expect(items.map((i) => i.path)).toEqual(['ok.txt'])
  })

  it('加密条目被标记并跳过', async () => {
    const encrypted = makeZip([
      { name: 'secret.txt', data: new TextEncoder().encode('x'), encrypted: true },
      { name: 'plain.txt', data: new TextEncoder().encode('y') },
    ])
    const inspection = await inspectArchive(encrypted, 'zip')
    expect(inspection.encryptedCount).toBe(1)
    const plan = planExtraction(inspection, { conflict: 'rename', platform: 'linux' })
    expect(plan.skipped.encrypted).toBe(1)
    const { items } = await collect(encrypted, 'zip', inspection)
    expect(items.map((i) => i.path)).toEqual(['plain.txt'])
  })
})

describe('同名策略规划', () => {
  const duplicateZip = makeZip([
    { name: 'a.txt', data: new TextEncoder().encode('1') },
    { name: 'a.txt', data: new TextEncoder().encode('2') },
    { name: 'A.txt', data: new TextEncoder().encode('3') },
  ])

  it('rename 为后出现的条目生成新名称', async () => {
    const inspection = await inspectArchive(duplicateZip, 'zip')
    const plan = planExtraction(inspection, { conflict: 'rename', platform: 'win32' })
    expect(plan.items.map((i) => i.targetPath)).toEqual(['a.txt', 'a (1).txt', 'A (2).txt'])
    expect(plan.skipped.duplicate).toBe(0)
  })

  it('skip 丢弃重复条目', async () => {
    const inspection = await inspectArchive(duplicateZip, 'zip')
    const plan = planExtraction(inspection, { conflict: 'skip', platform: 'linux' })
    expect(plan.items.map((i) => i.targetPath)).toEqual(['a.txt', null, 'A.txt'])
    expect(plan.skipped.duplicate).toBe(1)
  })

  it('overwrite 保留同一目标路径（后写覆盖）', async () => {
    const inspection = await inspectArchive(duplicateZip, 'zip')
    const plan = planExtraction(inspection, { conflict: 'overwrite', platform: 'linux' })
    expect(plan.items.map((i) => i.targetPath)).toEqual(['a.txt', 'a.txt', 'A.txt'])
  })
})

describe('tar / tar.gz', () => {
  const tar = makeTar([
    { name: 'dir/', type: '5' },
    { name: 'dir/a.txt', data: new TextEncoder().encode('tar-a') },
    { name: 'link', type: '2', linkname: '../outside' },
    {
      name: 'short.txt',
      data: new TextEncoder().encode('long-name-data'),
      longName: 'very/very/long/path/name-that-exceeds-100-chars.txt',
    },
  ])

  it('解析 ustar / GNU 长名 / 目录 / 符号链接', async () => {
    const inspection = await inspectArchive(tar, 'tar')
    expect(inspection.entries.map((e) => e.path)).toEqual([
      'dir',
      'dir/a.txt',
      'link',
      'very/very/long/path/name-that-exceeds-100-chars.txt',
    ])
    expect(inspection.symlinkCount).toBe(1)
    expect(inspection.entries[2].kind).toBe('symlink')
  })

  it('解压跳过符号链接并还原文件内容', async () => {
    const inspection = await inspectArchive(tar, 'tar')
    const { items } = await collect(tar, 'tar', inspection, 'rename', 'linux')
    expect(items.map((i) => i.path)).toEqual([
      'dir',
      'dir/a.txt',
      'very/very/long/path/name-that-exceeds-100-chars.txt',
    ])
    expect(new TextDecoder().decode(items[1].data)).toBe('tar-a')
  })

  it('tar.gz 预解压后按 tar 处理', async () => {
    const gz = new Uint8Array(zlib.gzipSync(Buffer.from(tar)))
    expect(detectArchiveFormat('bundle.tar.gz', gz).format).toBe('tar.gz')
    const prepared = await prepareArchive(gz, 'tar.gz')
    expect(prepared.format).toBe('tar')
    const inspection = await inspectArchive(prepared.bytes, prepared.format, 'bundle.tar.gz')
    expect(inspection.totalFiles).toBe(2)
    const { items } = await collect(prepared.bytes, 'tar', inspection)
    expect(items.some((i) => i.path === 'dir/a.txt')).toBe(true)
  })
})

describe('gz 单文件', () => {
  it('列表阶段大小未知，解压后按去扩展名命名', async () => {
    const data = new TextEncoder().encode('single file content')
    const gz = new Uint8Array(zlib.gzipSync(Buffer.from(data)))
    const inspection = await inspectArchive(gz, 'gz', 'note.txt.gz')
    expect(inspection.entries).toHaveLength(1)
    expect(inspection.entries[0].sizeUnknown).toBe(true)
    expect(inspection.entries[0].path).toBe('note.txt')

    const { items } = await collect(gz, 'gz', inspection)
    expect(items).toHaveLength(1)
    expect(items[0].path).toBe('note.txt')
    expect(new TextDecoder().decode(items[0].data)).toBe('single file content')
  })

  it('gunzip 对损坏数据给出可读错误', async () => {
    await expect(gunzip(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))).rejects.toThrow('gzip 解压失败')
  })
})

describe('取消与进度', () => {
  it('isCancelled 立即为 true 时不产出任何条目', async () => {
    const zip = makeZip([{ name: 'a.txt', data: new TextEncoder().encode('a') }])
    const inspection = await inspectArchive(zip, 'zip')
    const plan = planExtraction(inspection, { conflict: 'rename', platform: 'linux' })
    const items: ExtractedItem[] = []
    for await (const item of extractArchive(zip, 'zip', inspection, plan.items, {
      isCancelled: () => true,
    })) {
      items.push(item)
    }
    expect(items).toHaveLength(0)
  })
})
