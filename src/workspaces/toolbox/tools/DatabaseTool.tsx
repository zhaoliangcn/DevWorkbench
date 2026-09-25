import { useState } from 'react'

interface DBConnection {
  id: string
  name: string
  type: 'mysql' | 'postgresql' | 'redis' | 'mongodb'
  host: string
  port: number
  database: string
  username: string
  password: string
}

export function DatabaseTool() {
  const [connections, setConnections] = useState<DBConnection[]>([])
  const [activeConnection, setActiveConnection] = useState<DBConnection | null>(null)
  const [connected, setConnected] = useState(false)
  const [sqlInput, setSqlInput] = useState('')
  const [sqlResult, setSqlResult] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingConn, setEditingConn] = useState<DBConnection>({
    id: '',
    name: '',
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    database: '',
    username: '',
    password: '',
  })

  const defaultPort = (type: DBConnection['type']) => {
    switch (type) {
      case 'mysql': return 3306
      case 'postgresql': return 5432
      case 'redis': return 6379
      case 'mongodb': return 27017
    }
  }

  const addConnection = () => {
    setEditingConn({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: '',
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      database: '',
      username: 'root',
      password: '',
    })
    setShowForm(true)
  }

  const saveConnection = () => {
    if (!editingConn.name || !editingConn.host) return
    if (connections.find((c) => c.id === editingConn.id)) {
      setConnections(connections.map((c) => (c.id === editingConn.id ? editingConn : c)))
    } else {
      setConnections([...connections, editingConn])
    }
    setShowForm(false)
  }

  const connect = (conn: DBConnection) => {
    setActiveConnection(conn)
    setConnected(true)
    setSqlResult(`模拟连接成功: ${conn.type}://${conn.username}@${conn.host}:${conn.port}/${conn.database}`)
  }

  const disconnect = () => {
    setActiveConnection(null)
    setConnected(false)
    setSqlResult('')
    setSqlInput('')
  }

  const executeSQL = () => {
    if (!activeConnection || !sqlInput) return
    setSqlResult(`模拟执行 SQL (${activeConnection.type}):\n${sqlInput}\n\n结果: 查询成功 (模拟数据)`)
  }

  const formatSQL = () => {
    if (!sqlInput) return
    const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'LIMIT', 'CREATE', 'TABLE', 'VALUES', 'SET']
    let formatted = sqlInput
    keywords.forEach((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, 'gi')
      formatted = formatted.replace(regex, `\n${kw}`)
    })
    setSqlInput(formatted.trim())
  }

  const compressSQL = () => {
    if (!sqlInput) return
    setSqlInput(sqlInput.replace(/\s+/g, ' ').trim())
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>数据库工具</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <div className="section-header">
            <h4>连接列表</h4>
            <button onClick={addConnection} className="btn-secondary">+ 添加连接</button>
          </div>
          <div className="connections-list">
            {connections.map((conn) => (
              <div key={conn.id} className={`connection-item ${activeConnection?.id === conn.id ? 'active' : ''}`}>
                <div className="connection-info">
                  <span className="conn-type">{conn.type.toUpperCase()}</span>
                  <span className="conn-name">{conn.name}</span>
                  <span className="conn-host">{conn.host}:{conn.port}</span>
                </div>
                <div className="connection-actions">
                  {!connected ? (
                    <button onClick={() => connect(conn)} className="btn-secondary">连接</button>
                  ) : (
                    <button onClick={disconnect} className="btn-danger">断开</button>
                  )}
                </div>
              </div>
            ))}
            {connections.length === 0 && (
              <div className="empty-state">
                <p>暂无数据库连接</p>
              </div>
            )}
          </div>
        </div>

        {connected && activeConnection && (
          <>
            <div className="tool-section">
              <h4>SQL 编辑</h4>
              <textarea
                value={sqlInput}
                onChange={(e) => setSqlInput(e.target.value)}
                placeholder={`输入 SQL 语句 (${activeConnection.type})`}
                rows={6}
                className="sql-editor"
              />
              <div className="tool-actions">
                <button onClick={executeSQL} disabled={!sqlInput}>执行</button>
                <button onClick={formatSQL} disabled={!sqlInput} className="btn-secondary">格式化</button>
                <button onClick={compressSQL} disabled={!sqlInput} className="btn-secondary">压缩</button>
              </div>
            </div>

            {sqlResult && (
              <div className="tool-section">
                <h4>结果</h4>
                <div className="result-display">
                  <textarea value={sqlResult} readOnly rows={6} />
                </div>
              </div>
            )}
          </>
        )}

        {showForm && (
          <div className="tool-section form-panel">
            <h4>{editingConn.id && connections.find((c) => c.id === editingConn.id) ? '编辑' : '添加'}连接</h4>
            <div className="form-row">
              <label>名称</label>
              <input
                type="text"
                value={editingConn.name}
                onChange={(e) => setEditingConn({ ...editingConn, name: e.target.value })}
                placeholder="连接名称"
              />
            </div>
            <div className="form-row">
              <label>类型</label>
              <select
                value={editingConn.type}
                onChange={(e) => {
                  const type = e.target.value as DBConnection['type']
                  setEditingConn({ ...editingConn, type, port: defaultPort(type) })
                }}
              >
                <option value="mysql">MySQL</option>
                <option value="postgresql">PostgreSQL</option>
                <option value="redis">Redis</option>
                <option value="mongodb">MongoDB</option>
              </select>
            </div>
            <div className="form-row">
              <label>主机</label>
              <input
                type="text"
                value={editingConn.host}
                onChange={(e) => setEditingConn({ ...editingConn, host: e.target.value })}
                placeholder="localhost"
              />
            </div>
            <div className="form-row">
              <label>端口</label>
              <input
                type="number"
                value={editingConn.port}
                onChange={(e) => setEditingConn({ ...editingConn, port: Number(e.target.value) })}
              />
            </div>
            <div className="form-row">
              <label>数据库</label>
              <input
                type="text"
                value={editingConn.database}
                onChange={(e) => setEditingConn({ ...editingConn, database: e.target.value })}
                placeholder="数据库名"
              />
            </div>
            <div className="form-row">
              <label>用户名</label>
              <input
                type="text"
                value={editingConn.username}
                onChange={(e) => setEditingConn({ ...editingConn, username: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>密码</label>
              <input
                type="password"
                value={editingConn.password}
                onChange={(e) => setEditingConn({ ...editingConn, password: e.target.value })}
              />
            </div>
            <div className="form-actions">
              <button onClick={saveConnection}>保存</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
