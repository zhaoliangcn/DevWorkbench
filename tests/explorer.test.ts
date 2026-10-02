// 开发助手：explorer 主进程核心逻辑测试（路径校验/列表/读写/重命名/删除）
// 覆盖：resolveSafeEx 越界与兄弟目录前缀缺陷、listEntries 排序与剪枝、
//       二进制嗅探、write→read 往返、rename/createFile/delete 边界
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: {},
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

import {
  resolveSafeEx,
  listEntries,
  readEntry,
  readEntryBinary,
  writeEntry,
  statEntry,
  makeDir,
  createEntryFile,
  renameEntry,
  deleteEntry,
} from '../electron/ipc/explorer'

let tmp = ''

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-test-'))
  // 目录树：a.txt / zz目录/ / node_modules（剪）/ .git（剪）/ sub/nested.txt
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello explorer')
  fs.writeFileSync(path.join(tmp, 'logo.png'), 'fake png content')
  fs.mkdirSync(path.join(tmp, 'zz目录'))
  fs.writeFileSync(path.join(tmp, 'zz目录', 'b.md'), '# md')
  fs.mkdirSync(path.join(tmp, 'node_modules', 'x'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'node_modules', 'x', 'i.js'), 'x')
  fs.mkdirSync(path.join(tmp, '.git'), { recursive: true })
  fs.writeFileSync(path.join(tmp, '.git', 'config'), 'git')
  fs.mkdirSync(path.join(tmp, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'sub', 'nested.txt'), 'nested')
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('resolveSafeEx（路径防穿越）', () => {
  it('root 内合法相对路径可解析', () => {
    expect(resolveSafeEx(tmp, 'a.txt')).toBe(path.join(tmp, 'a.txt'))
    expect(resolveSafeEx(tmp, 'sub/nested.txt')).toBe(path.join(tmp, 'sub', 'nested.txt'))
  })

  it('空 rel 返回 root 本身', () => {
    expect(path.resolve(resolveSafeEx(tmp, ''))).toBe(path.resolve(tmp))
  })

  it('.. 越界抛错', () => {
    expect(() => resolveSafeEx(tmp, '..')).toThrow('路径越界')
    expect(() => resolveSafeEx(path.join(tmp, 'sub'), '../../a.txt')).toThrow('路径越界')
  })

  it('兄弟目录前缀不误判（修复 startsWith 前缀缺陷）', () => {
    // probe 形如 <tmp>x/evil.txt：以 tmp 为字符串前缀但越出 root，必须拒绝
    const probe = path.join(path.dirname(tmp), path.basename(tmp) + 'x', 'evil.txt')
    expect(probe.startsWith(tmp) && !probe.startsWith(tmp + path.sep)).toBe(true)
    expect(() => resolveSafeEx(tmp, probe)).toThrow('路径越界')
  })
})

describe('listEntries（列表/排序/剪枝）', () => {
  it('目录优先、名称排序、剪枝 node_modules 与 .git、relPath 用 / 分隔', async () => {
    const r = await listEntries(tmp, '')
    expect(r.success).toBe(true)
    if (!r.success) return
    const names = r.entries.map((e) => e.name)
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.git')
    const dirs = r.entries.filter((e) => e.kind === 'dir').map((e) => e.name)
    expect(dirs).toEqual(['sub', 'zz目录']) // 目录组在前，组内名称排序
    const files = r.entries.filter((e) => e.kind === 'file').map((e) => e.name)
    expect(files).toEqual(['a.txt', 'logo.png'])
  })

  it('子目录列表 relPath 带父前缀', async () => {
    const r = await listEntries(tmp, 'sub')
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.entries).toEqual([{ name: 'nested.txt', relPath: 'sub/nested.txt', kind: 'file', size: 6 }])
  })

  it('不存在的目录返回失败', async () => {
    const r = await listEntries(tmp, 'no-such-dir')
    expect(r.success).toBe(false)
  })
})

describe('readEntry（文本/二进制/超大）', () => {
  it('文本读取返回内容与 mtime', async () => {
    const r = await readEntry(tmp, 'a.txt')
    expect(r).toMatchObject({ success: true, kind: 'text', content: 'hello explorer', size: 14 })
  })

  it('已知图片扩展名直接判 binary（嗅探兜底）', async () => {
    const r = await readEntry(tmp, 'logo.png')
    expect(r).toMatchObject({ success: true, kind: 'binary' })
  })

  it('NUL 字节嗅探兜底未知扩展名', async () => {
    fs.writeFileSync(path.join(tmp, 'blob.datx'), Buffer.from([0x01, 0x02, 0x00, 0x03]))
    const r = await readEntry(tmp, 'blob.datx')
    expect(r).toMatchObject({ success: true, kind: 'binary' })
  })

  it('超过 2MB 返回 tooLarge', async () => {
    fs.writeFileSync(path.join(tmp, 'big.log'), 'x'.repeat(2 * 1024 * 1024 + 1))
    const r = await readEntry(tmp, 'big.log')
    expect(r).toMatchObject({ success: true, kind: 'tooLarge' })
  })
})

describe('readEntryBinary（图片预览通道）', () => {
  it('base64 回传与 mime 识别', async () => {
    const r = await readEntryBinary(tmp, 'logo.png')
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.mime).toBe('image/png')
    expect(Buffer.from(r.base64, 'base64').toString('utf8')).toBe('fake png content')
  })

  it('未知二进制回落 octet-stream', async () => {
    const r = await readEntryBinary(tmp, 'blob.datx')
    expect(r.success).toBe(true)
    if (r.success) expect(r.mime).toBe('application/octet-stream')
  })
})

describe('writeEntry → readEntry 往返', () => {
  it('写入后可读回，嵌套父目录自动创建', async () => {
    const w = await writeEntry(tmp, 'deep/nest/new.txt', 'round trip')
    expect(w.success).toBe(true)
    const r = await readEntry(tmp, 'deep/nest/new.txt')
    expect(r).toMatchObject({ success: true, kind: 'text', content: 'round trip' })
  })

  it('write 越界拒绝', async () => {
    const w = await writeEntry(tmp, '../evil.txt', 'x')
    expect(w.success).toBe(false)
  })
})

describe('statEntry / makeDir', () => {
  it('stat 区分目录与文件', async () => {
    expect(await statEntry(tmp, 'sub')).toMatchObject({ success: true, kind: 'dir' })
    expect(await statEntry(tmp, 'a.txt')).toMatchObject({ success: true, kind: 'file' })
  })

  it('mkdir recursive 幂等', async () => {
    expect((await makeDir(tmp, 'deep/nest')).success).toBe(true)
    expect((await makeDir(tmp, 'deep/nest')).success).toBe(true)
  })
})

describe('createEntryFile / renameEntry / deleteEntry', () => {
  it('createFile 已存在即失败，新建为空文件', async () => {
    expect((await createEntryFile(tmp, 'a.txt')).success).toBe(false)
    const r = await createEntryFile(tmp, 'fresh.txt')
    expect(r.success).toBe(true)
    expect(fs.readFileSync(path.join(tmp, 'fresh.txt'), 'utf8')).toBe('')
  })

  it('rename 成功后旧路径消失、新路径可读', async () => {
    await writeEntry(tmp, 'ren-src.txt', 'rename me')
    expect((await renameEntry(tmp, 'ren-src.txt', 'ren-dst.txt')).success).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'ren-src.txt'))).toBe(false)
    expect((await readEntry(tmp, 'ren-dst.txt')).success).toBe(true)
  })

  it('rename 名称非法与目标已存在均失败', async () => {
    expect((await renameEntry(tmp, 'ren-dst.txt', '../outside.txt')).success).toBe(false)
    expect((await renameEntry(tmp, 'ren-dst.txt', 'a.txt')).success).toBe(false)
  })

  it('delete 删除文件与目录，root 自身拒绝', async () => {
    expect((await deleteEntry(tmp, 'ren-dst.txt')).success).toBe(true)
    expect((await deleteEntry(tmp, 'deep')).success).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'deep'))).toBe(false)
    expect((await deleteEntry(tmp, '')).success).toBe(false)
  })
})
