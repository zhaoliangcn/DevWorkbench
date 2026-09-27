// 附录 F F.6：SQLite 浏览器（better-sqlite3 同步 API，主进程单例连接）
// 工程决策 F.4#4：native 模块放 optionalDependencies，首次打开动态 import，失败降级「未安装」。
// 风险 F.5#5：数据浏览器分页 LIMIT 200/页，不物化全表。
import { ipcMain, dialog } from 'electron'
import type BetterSqlite3 from 'better-sqlite3'

type SqliteDatabase = BetterSqlite3.Database

const PAGE_SIZE = 200
const CELL_LIMIT = 200 // 单元格字符上限，防超宽 BLOB/TEXT 拖垮渲染层

let db: SqliteDatabase | null = null

/* ---------- 可测纯逻辑 ---------- */

/** 标识符安全化：双引号包裹 + 转义，防注入（表/列名来自用户库） */
export function safeIdent(name: string): string {
  if (!name || name.includes('\0')) throw new Error(`非法标识符："${name}"`)
  return `"${name.replace(/"/g, '""')}"`
}

/** 单元格值归一化（Buffer → utf8 截断；bigint → 字符串） */
export function serializeCell(v: unknown): unknown {
  if (Buffer.isBuffer(v)) {
    const s = v.toString('utf8')
    return s.length > CELL_LIMIT ? `${s.slice(0, CELL_LIMIT)}…[截断]` : s
  }
  if (typeof v === 'bigint') return v.toString()
  return v
}

export function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[k] = serializeCell(v)
  return out
}

/* ---------- 动态加载（失败降级） ---------- */

export async function checkSqliteAvailable(): Promise<{ available: boolean; error?: string }> {
  try {
    await import('better-sqlite3')
    return { available: true }
  } catch (e) {
    return {
      available: false,
      error: `better-sqlite3 未安装或 ABI 不匹配：${(e as Error).message}。可执行 npm install --save-optional better-sqlite3 安装。`,
    }
  }
}

/* ---------- IPC ---------- */

function requireDb(): SqliteDatabase {
  if (!db) throw new Error('未打开数据库文件')
  return db
}

function registerSqliteIpc() {
  ipcMain.handle('sqlite:check', () => checkSqliteAvailable())

  ipcMain.handle('sqlite:open', async () => {
    const result = await dialog.showOpenDialog({
      title: '打开 SQLite 数据库',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }
    const filePath = result.filePaths[0]
    try {
      const BetterDatabase = (await import('better-sqlite3')).default
      if (db) db.close()
      db = new BetterDatabase(filePath, { fileMustExist: true }) as SqliteDatabase
      const name = filePath.split('/').pop() ?? filePath
      return { success: true, filePath, name }
    } catch (e) {
      db = null
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('sqlite:tables', async () => {
    try {
      const d = requireDb()
      const tables = d
        .prepare(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .all() as { name: string; type: string }[]
      return { success: true, tables }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('sqlite:columns', async (_event, table: string) => {
    try {
      const d = requireDb()
      const cols = d.pragma(`table_info(${safeIdent(table)})`) as { name: string; type: string; pk: number }[]
      return { success: true, columns: cols.map((c) => ({ name: c.name, type: c.type, pk: c.pk > 0 })) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('sqlite:rows', async (_event, table: string, where: string, page: number) => {
    try {
      const d = requireDb()
      const ident = safeIdent(table)
      const whereSql = where?.trim() ? ` WHERE (${where.trim()})` : ''
      const safePage = Math.max(Math.floor(page) || 1, 1)
      const total = (
        d.prepare(`SELECT COUNT(*) AS n FROM ${ident}${whereSql}`).get() as { n: number }
      ).n
      const rows = d
        .prepare(`SELECT * FROM ${ident}${whereSql} LIMIT ${PAGE_SIZE} OFFSET ${(safePage - 1) * PAGE_SIZE}`)
        .all() as Record<string, unknown>[]
      const stmt = d.prepare(`SELECT * FROM ${ident}${whereSql} LIMIT 0`)
      const columns = stmt.columns().map((c) => c.name)
      return { success: true, rows: rows.map(serializeRow), columns, total, page: safePage, pageSize: PAGE_SIZE }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('sqlite:exec', async (_event, sql: string) => {
    try {
      const d = requireDb()
      const trimmed = (sql ?? '').trim()
      if (!trimmed) return { success: false, error: '空语句' }
      if (/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
        const stmt = d.prepare(trimmed)
        const rows = stmt.all() as Record<string, unknown>[]
        const columns = stmt.columns().map((c) => c.name)
        return { success: true, rows: rows.map(serializeRow), columns, changes: 0 }
      }
      d.exec(trimmed)
      // @types/better-sqlite3 未声明 getRowsModified（实际 API 存在），局部断言
      const modified = (d as unknown as { getRowsModified(): number }).getRowsModified()
      return { success: true, rows: [], columns: [], changes: modified }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('sqlite:close', () => {
    if (db) {
      db.close()
      db = null
    }
    return { success: true }
  })
}

function stopSqlite(): void {
  try {
    db?.close()
  } finally {
    db = null
  }
}

export { registerSqliteIpc, stopSqlite }
