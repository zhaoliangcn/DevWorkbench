import { useEffect, useState } from 'react'
import { electronAPI } from '../utils/electron'

interface SqliteRecent {
  id: string
  name: string
  filePath: string
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 附录 F F.6：SQLite 浏览器面板（文件打开 + 表浏览 + WHERE 过滤 + SQL 控制台） */
export function SqlitePanel() {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checkError, setCheckError] = useState('')
  const [filePath, setFilePath] = useState('')
  const [recents, setRecents] = useState<SqliteRecent[]>([])
  const [error, setError] = useState('')

  const [tables, setTables] = useState<{ name: string; type: string }[]>([])
  const [activeTable, setActiveTable] = useState('')
  const [columns, setColumns] = useState<{ name: string; type: string; pk: boolean }[]>([])
  const [where, setWhere] = useState('')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [rowColumns, setRowColumns] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const [sql, setSql] = useState('')
  const [sqlResult, setSqlResult] = useState('')

  useEffect(() => {
    void electronAPI.sqliteCheck().then((r) => {
      setAvailable(r.available)
      if (!r.available && r.error) setCheckError(r.error)
    })
    void electronAPI.loadData('sqlite').then((d) => {
      const list = (d as { recents?: SqliteRecent[] } | null)?.recents
      if (Array.isArray(list)) setRecents(list)
    })
  }, [])

  const persistRecents = (next: SqliteRecent[]) => {
    setRecents(next)
    void electronAPI.saveData('sqlite', { recents: next })
  }

  const loadTables = async () => {
    const r = await electronAPI.sqliteTables()
    if (!r.success) return setError(r.error ?? '读取表失败')
    setTables(r.tables ?? [])
  }

  const openDb = async () => {
    setError('')
    setSqlResult('')
    const r = await electronAPI.sqliteOpen()
    if (r.canceled) return
    if (!r.success || !r.filePath) return setError(r.error ?? '打开失败')
    setFilePath(r.filePath)
    const item: SqliteRecent = { id: genId(), name: r.name ?? r.filePath, filePath: r.filePath }
    persistRecents([item, ...recents.filter((x) => x.filePath !== r.filePath)].slice(0, 5))
    await loadTables()
  }

  const reopenPath = async () => {
    // recents 仅记录路径；重新打开走 dialog 重新选择（不静默重开外部路径）
    await openDb()
  }

  const closeDb = async () => {
    await electronAPI.sqliteClose()
    setFilePath('')
    setTables([])
    setActiveTable('')
    setRows([])
    setRowColumns([])
    setColumns([])
    setTotal(0)
    setPage(1)
    setSqlResult('')
  }

  const selectTable = async (name: string) => {
    setActiveTable(name)
    setPage(1)
    setWhere('')
    setError('')
    const c = await electronAPI.sqliteColumns(name)
    if (c.success) setColumns(c.columns ?? [])
    await loadRows(name, '', 1)
  }

  const loadRows = async (table = activeTable, whereClause = where, targetPage = page) => {
    if (!table) return
    setLoading(true)
    const r = await electronAPI.sqliteRows(table, whereClause, targetPage)
    setLoading(false)
    if (!r.success) return setError(r.error ?? '查询失败')
    setRows(r.rows ?? [])
    setRowColumns(r.columns ?? [])
    setTotal(r.total ?? 0)
    setPage(r.page ?? 1)
  }

  const applyFilter = () => {
    setPage(1)
    void loadRows(activeTable, where, 1)
  }

  const runSql = async () => {
    if (!sql.trim()) return
    setError('')
    const r = await electronAPI.sqliteExec(sql.trim())
    if (!r.success) {
      setSqlResult(`✗ ${r.error ?? '执行失败'}`)
      return
    }
    const head = `columns: ${(r.columns ?? []).join(', ') || '—'}`
    const body = (r.rows ?? []).length > 0 ? JSON.stringify(r.rows, null, 2) : `changes: ${r.changes ?? 0}`
    setSqlResult(`(${r.rows?.length ?? 0} 行)\n${head}\n${body}`)
    await loadTables() // DDL/DML 后刷新表列表
    if (activeTable) void loadRows()
  }

  const totalPages = Math.max(Math.ceil(total / 200), 1)

  return (
    <div className="sqlite-panel">
      {available === false && (
        <div className="tool-section">
          <p className="cron-error">better-sqlite3 不可用（可选依赖）。{checkError}</p>
        </div>
      )}
      {available === true && (
        <div className="tool-section">
          <div className="section-header">
            <h4>{filePath ? `数据库：${filePath.split('/').pop()}` : 'SQLite 数据库'}</h4>
            <div className="sqlite-header-actions">
              {filePath ? (
                <button className="btn-danger" onClick={() => void closeDb()}>关闭</button>
              ) : (
                <button onClick={() => void openDb()}>打开数据库文件…</button>
              )}
            </div>
          </div>
          {!filePath && recents.length > 0 && (
            <div className="connections-list">
              <span className="panel-empty-text">最近打开：</span>
              {recents.map((r) => (
                <button key={r.id} className="btn-secondary sqlite-recent" onClick={() => void reopenPath()} title={r.filePath}>
                  {r.name}
                </button>
              ))}
            </div>
          )}
          {error && <p className="cron-error">{error}</p>}
        </div>
      )}

      {available === true && filePath && (
        <>
          <div className="tool-section">
            <h4>表 / 视图</h4>
            {tables.length === 0 ? (
              <p className="panel-empty-text">无表。</p>
            ) : (
              <div className="sqlite-table-list">
                {tables.map((t) => (
                  <button
                    key={t.name}
                    className={`btn-secondary sqlite-table-btn ${t.name === activeTable ? 'active' : ''}`}
                    onClick={() => void selectTable(t.name)}
                  >
                    {t.type === 'view' ? '👁 ' : '▤ '}{t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeTable && (
            <div className="tool-section">
              <div className="section-header">
                <h4>数据浏览 {columns.length > 0 && `· ${columns.map((c) => c.name).join(', ')}`}</h4>
                <span className="redis-ttl">共 {total} 行 · 200 行/页</span>
              </div>
              <div className="cron-add-row">
                <input
                  value={where}
                  onChange={(e) => setWhere(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyFilter()
                  }}
                  placeholder={`WHERE 条件，如 age > 18 AND name LIKE 'a%'（留空显示全部）`}
                  spellCheck={false}
                />
                <button className="btn-secondary" onClick={applyFilter}>过滤</button>
                <button className="btn-secondary" onClick={() => { setWhere(''); setPage(1); void loadRows(activeTable, '', 1) }}>重置</button>
              </div>
              {loading ? (
                <p className="panel-empty-text">加载中…</p>
              ) : rows.length === 0 ? (
                <p className="panel-empty-text">无数据。</p>
              ) : (
                <div className="sqlite-grid-wrap">
                  <table className="sqlite-grid">
                    <thead>
                      <tr>
                        {rowColumns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i}>
                          {rowColumns.map((c) => (
                            <td key={c} title={fmtCell(row[c])}>{fmtCell(row[c])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="sqlite-pager">
                <button className="btn-secondary" disabled={page <= 1} onClick={() => void loadRows(activeTable, where, page - 1)}>上一页</button>
                <span>第 {page} / {totalPages} 页</span>
                <button className="btn-secondary" disabled={page >= totalPages} onClick={() => void loadRows(activeTable, where, page + 1)}>下一页</button>
              </div>
            </div>
          )}

          <div className="tool-section">
            <h4>SQL 控制台（读写）</h4>
            <textarea
              className="cron-command-input"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={3}
              placeholder="SELECT * FROM users LIMIT 10  /  UPDATE ...  /  CREATE TABLE ..."
              spellCheck={false}
            />
            <div className="cron-add-row">
              <button onClick={() => void runSql()}>执行</button>
              <button className="btn-secondary" onClick={() => { setSql(''); setSqlResult('') }}>清空</button>
            </div>
            {sqlResult && <pre className="webhook-pre redis-result">{sqlResult}</pre>}
          </div>
        </>
      )}
    </div>
  )
}
