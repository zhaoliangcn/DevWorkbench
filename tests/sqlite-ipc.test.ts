// 附录 F F.6：SQLite 浏览器测试（标识符安全化 + 单元格归一化 + IPC 流程，better-sqlite3 mock）
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

/* ---------- electron mock（ipcMain.handle 捕获 + dialog） ---------- */

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const dialogMock = { showOpenDialog: vi.fn() }
  return { handlers, dialogMock }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, fn)
    }),
  },
  dialog: electronMocks.dialogMock,
}))

/* ---------- better-sqlite3 mock ---------- */

const bs3Mocks = vi.hoisted(() => {
  const prepareMock = vi.fn()
  const execMock = vi.fn()
  const pragmaMock = vi.fn()
  const closeMock = vi.fn()
  const getRowsModifiedMock = vi.fn()
  class MockDatabase {
    prepare = prepareMock
    exec = execMock
    pragma = pragmaMock
    close = closeMock
    getRowsModified = getRowsModifiedMock
    constructor(public path: string, public opts?: unknown) {}
  }
  return { MockDatabase, prepareMock, execMock, pragmaMock, closeMock, getRowsModifiedMock }
})

vi.mock('better-sqlite3', () => ({ default: bs3Mocks.MockDatabase }))

import { safeIdent, serializeCell, serializeRow, registerSqliteIpc } from '../electron/ipc/sqlite'

const invoke = (channel: string, ...args: unknown[]) =>
  electronMocks.handlers.get(channel)!(null, ...args) as Promise<Record<string, unknown>>

beforeAll(() => {
  registerSqliteIpc()
})

afterAll(() => {
  vi.clearAllMocks()
})

describe('safeIdent（标识符安全化）', () => {
  it('普通标识符用双引号包裹', () => {
    expect(safeIdent('users')).toBe('"users"')
  })

  it('内嵌双引号转义为两个双引号', () => {
    expect(safeIdent('we"ird')).toBe('"we""ird"')
  })

  it('空标识符与 NUL 拒绝', () => {
    expect(() => safeIdent('')).toThrow('非法标识符')
    expect(() => safeIdent('a\0b')).toThrow('非法标识符')
  })
})

describe('serializeCell / serializeRow（单元格归一化）', () => {
  it('Buffer → utf8；bigint → 字符串；null 透传', () => {
    expect(serializeCell(Buffer.from('数据'))).toBe('数据')
    expect(serializeCell(10n)).toBe('10')
    expect(serializeCell(null)).toBeNull()
  })

  it('超长 Buffer 截断', () => {
    const out = serializeCell(Buffer.alloc(300, 'x')) as string
    expect(out.length).toBeLessThan(300)
    expect(out).toContain('截断')
  })

  it('serializeRow 逐列归一化', () => {
    expect(serializeRow({ a: 1, b: Buffer.from('x'), c: null })).toEqual({ a: 1, b: 'x', c: null })
  })
})

describe('IPC 流程（better-sqlite3 mock）', () => {
  it('check：动态 import 成功 → available', async () => {
    const r = await invoke('sqlite:check')
    expect(r.available).toBe(true)
  })

  it('open：用户取消返回 canceled', async () => {
    electronMocks.dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const r = await invoke('sqlite:open')
    expect(r.success).toBe(false)
    expect(r.canceled).toBe(true)
  })

  it('open：选择文件后创建实例并返回路径与名称', async () => {
    electronMocks.dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/demo.db'] })
    const r = await invoke('sqlite:open')
    expect(r.success).toBe(true)
    expect(r.filePath).toBe('/tmp/demo.db')
    expect(r.name).toBe('demo.db')
  })

  it('tables：sqlite_master 查询并过滤内部表', async () => {
    bs3Mocks.prepareMock.mockReturnValueOnce({ all: () => [{ name: 'users', type: 'table' }] })
    const r = await invoke('sqlite:tables')
    expect(bs3Mocks.prepareMock).toHaveBeenCalledWith(
      expect.stringContaining("type IN ('table','view')"),
    )
    expect(r.tables).toEqual([{ name: 'users', type: 'table' }])
  })

  it('rows：WHERE 括号包裹 + 分页 LIMIT/OFFSET + total', async () => {
    bs3Mocks.prepareMock.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT COUNT')) return { get: () => ({ n: 42 }) }
      if (sql.includes('LIMIT 0')) return { columns: () => [{ name: 'id' }, { name: 'name' }] }
      return { all: () => [{ id: 1, name: 'a' }] }
    })
    const r = await invoke('sqlite:rows', 'users', 'age > 18', 2)
    expect(r.success).toBe(true)
    expect(r.total).toBe(42)
    expect(r.page).toBe(2)
    expect(r.rows).toEqual([{ id: 1, name: 'a' }])
    // 第二页 OFFSET 200
    const rowsSql = 'SELECT * FROM "users" WHERE (age > 18) LIMIT 200 OFFSET 200'
    expect(bs3Mocks.prepareMock.mock.calls.some(([s]) => s === rowsSql)).toBe(true)
  })

  it('rows：含 NUL 的表名被 safeIdent 拦截（双引号转义后合法，不算注入）', async () => {
    const r = await invoke('sqlite:rows', 'users\0; DROP', '', 1)
    expect(r.success).toBe(false)
  })

  it('exec：SELECT 走 prepare().all() 返回行', async () => {
    bs3Mocks.prepareMock.mockReturnValueOnce({
      all: () => [{ id: 1 }],
      columns: () => [{ name: 'id' }],
    })
    const r = await invoke('sqlite:exec', 'SELECT id FROM users')
    expect(r.success).toBe(true)
    expect(r.rows).toEqual([{ id: 1 }])
    expect(r.columns).toEqual(['id'])
  })

  it('exec：UPDATE 走 exec + getRowsModified', async () => {
    bs3Mocks.getRowsModifiedMock.mockReturnValueOnce(3)
    const r = await invoke('sqlite:exec', "UPDATE users SET name = 'b' WHERE id = 1")
    expect(r.success).toBe(true)
    expect(r.changes).toBe(3)
    expect(r.rows).toEqual([])
  })

  it('exec：空语句与执行错误返回 error', async () => {
    const empty = await invoke('sqlite:exec', '   ')
    expect(empty.success).toBe(false)
    bs3Mocks.execMock.mockImplementationOnce(() => {
      throw new Error('no such table')
    })
    const bad = await invoke('sqlite:exec', 'DELETE FROM ghost')
    expect(bad.success).toBe(false)
    expect(bad.error).toContain('no such table')
  })

  it('close：关闭后 requireDb 报未打开', async () => {
    await invoke('sqlite:close')
    const r = await invoke('sqlite:tables')
    expect(r.success).toBe(false)
    expect(r.error).toContain('未打开')
  })
})
