import { useEffect, useMemo, useState } from 'react'
import { electronAPI } from '../utils/electron'

/** 存储侧连接（无密码，saveData 'redis'） */
interface SavedRedisConn {
  id: string
  name: string
  host: string
  port: number
  db: number
}

interface KeyGroup {
  prefix: string
  keys: string[]
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function groupKeys(keys: string[]): KeyGroup[] {
  const map = new Map<string, string[]>()
  for (const k of keys) {
    const prefix = k.includes(':') ? k.split(':')[0] : '(无前缀)'
    const list = map.get(prefix) ?? []
    list.push(k)
    map.set(prefix, list)
  }
  return [...map.entries()]
    .map(([prefix, ks]) => ({ prefix, keys: [...ks].sort() }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix))
}

/** 选中键后按类型取值 */
function valueCommand(type: string, key: string): string {
  switch (type) {
    case 'string': return `GET "${key}"`
    case 'hash': return `HGETALL "${key}"`
    case 'list': return `LRANGE "${key}" 0 -1`
    case 'set': return `SMEMBERS "${key}"`
    case 'zset': return `ZRANGE "${key}" 0 -1 WITHSCORES`
    default: return `TYPE "${key}"`
  }
}

/** 附录 F F.5：Redis 客户端面板（连接 + 命令 + 键空间树 + TTL） */
export function RedisPanel() {
  const [conns, setConns] = useState<SavedRedisConn[]>([])
  const [activeId, setActiveId] = useState('')
  const [activeVersion, setActiveVersion] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  // 连接表单（密码仅内存，不持久化）
  const [form, setForm] = useState({ name: '', host: 'localhost', port: 6379, db: 0, password: '' })

  // 命令行
  const [command, setCommand] = useState('PING')
  const [cmdResult, setCmdResult] = useState('')

  // 键空间
  const [match, setMatch] = useState('*')
  const [scanCursor, setScanCursor] = useState('0')
  const [allKeys, setAllKeys] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [expandedPrefix, setExpandedPrefix] = useState('')

  // 值查看
  const [selKey, setSelKey] = useState('')
  const [selType, setSelType] = useState('')
  const [selTtl, setSelTtl] = useState<number | null>(null)
  const [selValue, setSelValue] = useState('')

  useEffect(() => {
    void electronAPI.loadData('redis').then((d) => {
      const list = (d as SavedRedisConn[] | null) ?? []
      if (Array.isArray(list)) setConns(list)
    })
    return () => {
      // 组件卸载（切换工具）不断开主进程连接，便于来回切换保持会话
    }
  }, [])

  const groups = useMemo(() => groupKeys(allKeys), [allKeys])

  const persistConns = (next: SavedRedisConn[]) => {
    setConns(next)
    void electronAPI.saveData('redis', next)
  }

  const connect = async () => {
    setError('')
    if (!form.host.trim()) return setError('请填写主机地址')
    const id = genId()
    setConnecting(true)
    const r = await electronAPI.redisConnect({ id, host: form.host.trim(), port: form.port, password: form.password || undefined, db: form.db })
    setConnecting(false)
    if (!r.success) return setError(r.error ?? '连接失败')
    // 存储列表不含密码（F.2.5 数据归属）
    const saved: SavedRedisConn = { id, name: form.name.trim() || `${form.host}:${form.port}`, host: form.host.trim(), port: form.port, db: form.db }
    persistConns([...conns, saved])
    setActiveId(id)
    setActiveVersion(r.version ?? '')
    setAllKeys([])
    setScanCursor('0')
    void scan(id, '0')
  }

  const disconnect = async () => {
    if (!activeId) return
    await electronAPI.redisDisconnect(activeId)
    setActiveId('')
    setActiveVersion('')
    setAllKeys([])
    setScanCursor('0')
    setSelKey('')
    setSelValue('')
    setCmdResult('')
  }

  const removeConn = (c: SavedRedisConn) => {
    if (c.id === activeId) void disconnect()
    persistConns(conns.filter((x) => x.id !== c.id))
  }

  const scan = async (id: string = activeId, fromCursor: string = scanCursor) => {
    if (!id) return
    setScanning(true)
    const r = await electronAPI.redisScan(id, fromCursor, match, 100)
    setScanning(false)
    if (!r.success) return setError(r.error ?? 'SCAN 失败')
    const keys = r.keys ?? []
    setAllKeys((prev) => (fromCursor === '0' ? keys : [...prev, ...keys]))
    setScanCursor(r.cursor ?? '0')
    if (!r.cursor || r.cursor === '0') setExpandedPrefix('')
  }

  const rescan = () => {
    setAllKeys([])
    setScanCursor('0')
    void scan(activeId, '0')
  }

  const runCommand = async () => {
    if (!activeId || !command.trim()) return
    setError('')
    const r = await electronAPI.redisExec(activeId, command.trim())
    if (!r.success) {
      setCmdResult(`✗ ${r.error ?? '执行失败'}`)
      return
    }
    setCmdResult(`(${r.elapsedMs}ms)\n${JSON.stringify(r.value, null, 2)}`)
  }

  const selectKey = async (key: string) => {
    if (!activeId) return
    setSelKey(key)
    setSelValue('…')
    const t = await electronAPI.redisExec(activeId, `TYPE "${key}"`)
    const ttl = await electronAPI.redisExec(activeId, `TTL "${key}"`)
    setSelType(t.success ? String(t.value) : '?')
    setSelTtl(ttl.success ? Number(ttl.value) : null)
    const v = await electronAPI.redisExec(activeId, valueCommand(t.success ? String(t.value) : '', key))
    setSelValue(v.success ? JSON.stringify(v.value, null, 2) : `✗ ${v.error ?? '取值失败'}`)
  }

  return (
    <div className="redis-panel">
      <div className="tool-section">
        <div className="section-header">
          <h4>连接 {activeVersion && <span className="redis-version">Redis {activeVersion}</span>}</h4>
          {activeId ? (
            <button onClick={() => void disconnect()} className="btn-danger">断开</button>
          ) : (
            <span className="panel-empty-text">未连接</span>
          )}
        </div>
        {!activeId && (
          <div className="form-row-group">
            <div className="form-row">
              <label>名称</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="本地开发（可选）" />
            </div>
            <div className="form-row">
              <label>主机</label>
              <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="localhost" />
              <label>端口</label>
              <input type="number" className="redis-port-input" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
              <label>DB</label>
              <input type="number" className="redis-db-input" value={form.db} onChange={(e) => setForm({ ...form, db: Number(e.target.value) })} />
              <label>密码</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="无则留空" />
              <button onClick={() => void connect()} disabled={connecting}>{connecting ? '连接中…' : '连接'}</button>
            </div>
          </div>
        )}
        {conns.length > 0 && (
          <div className="connections-list">
            {conns.map((c) => (
              <div key={c.id} className={`connection-item ${c.id === activeId ? 'active' : ''}`}>
                <div className="connection-info">
                  <span className="conn-type">REDIS</span>
                  <span className="conn-name">{c.name}</span>
                  <span className="conn-host">{c.host}:{c.port}/db{c.db}</span>
                </div>
                <div className="connection-actions">
                  {c.id !== activeId && <button onClick={() => removeConn(c)} className="btn-secondary">移除</button>}
                </div>
              </div>
            ))}
          </div>
        )}
        {error && <p className="cron-error">{error}</p>}
      </div>

      {activeId && (
        <>
          <div className="tool-section">
            <h4>命令行</h4>
            <div className="url-bar">
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runCommand()
                }}
                placeholder="如 GET mykey / HGETALL myhash / SCAN 匹配走左侧键空间"
                spellCheck={false}
              />
              <button onClick={() => void runCommand()}>执行</button>
            </div>
            {cmdResult && <pre className="webhook-pre redis-result">{cmdResult}</pre>}
          </div>

          <div className="tool-section">
            <div className="section-header">
              <h4>键空间 {allKeys.length > 0 && `（已加载 ${allKeys.length}）`}</h4>
              <div className="url-bar redis-scan-bar">
                <input value={match} onChange={(e) => setMatch(e.target.value)} placeholder="MATCH 模式，如 app:*" spellCheck={false} />
                <button className="btn-secondary" onClick={rescan}>重新扫描</button>
                {scanCursor !== '0' && (
                  <button className="btn-secondary" onClick={() => void scan()} disabled={scanning}>
                    {scanning ? '扫描中…' : `加载更多（cursor ${scanCursor}）`}
                  </button>
                )}
              </div>
            </div>
            {groups.length === 0 ? (
              <p className="panel-empty-text">无键。用上方 MATCH 模式过滤后扫描。</p>
            ) : (
              <div className="redis-tree">
                {groups.map((g) => (
                  <div key={g.prefix} className="redis-tree-group">
                    <button
                      className="btn-secondary redis-tree-prefix"
                      onClick={() => setExpandedPrefix(expandedPrefix === g.prefix ? '' : g.prefix)}
                    >
                      {expandedPrefix === g.prefix ? '▾' : '▸'} {g.prefix} <span className="redis-count">({g.keys.length})</span>
                    </button>
                    {expandedPrefix === g.prefix && (
                      <div className="redis-tree-keys">
                        {g.keys.map((k) => (
                          <button
                            key={k}
                            className={`redis-tree-key ${k === selKey ? 'active' : ''}`}
                            onClick={() => void selectKey(k)}
                            title={k}
                          >
                            {k}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {selKey && (
            <div className="tool-section">
              <div className="section-header">
                <h4>键详情</h4>
                <span className="redis-ttl">
                  类型 <b>{selType || '?'}</b>
                  {selTtl === null ? '' : selTtl < 0 ? ' · TTL 永久' : ` · TTL ${selTtl}s`}
                </span>
              </div>
              <pre className="webhook-pre redis-result">{selValue}</pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}
