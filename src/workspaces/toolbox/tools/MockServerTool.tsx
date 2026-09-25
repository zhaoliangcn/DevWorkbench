import { useState } from 'react'

interface MockRule {
  id: string
  method: string
  path: string
  status: number
  body: string
  delay: number
  enabled: boolean
}

export function MockServerTool() {
  const [rules, setRules] = useState<MockRule[]>([])
  const [serverRunning, setServerRunning] = useState(false)
  const [serverPort, setServerPort] = useState(3000)
  const [editingRule, setEditingRule] = useState<MockRule | null>(null)
  const [showForm, setShowForm] = useState(false)

  const addRule = () => {
    const newRule: MockRule = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      method: 'GET',
      path: '/api/test',
      status: 200,
      body: '{"message": "Hello World"}',
      delay: 0,
      enabled: true,
    }
    setRules([...rules, newRule])
    setEditingRule(newRule)
    setShowForm(true)
  }

  const saveRule = () => {
    if (!editingRule) return
    setRules(rules.map(r => r.id === editingRule.id ? editingRule : r))
    setEditingRule(null)
    setShowForm(false)
  }

  const deleteRule = (id: string) => {
    setRules(rules.filter(r => r.id !== id))
  }

  const toggleRule = (id: string) => {
    setRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r))
  }

  const startServer = () => {
    setServerRunning(true)
  }

  const stopServer = () => {
    setServerRunning(false)
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>Mock 服务</h3>
        <div className="tool-actions">
          {!serverRunning ? (
            <button onClick={startServer} disabled={rules.filter(r => r.enabled).length === 0}>
              启动服务
            </button>
          ) : (
            <button onClick={stopServer} className="btn-danger">停止服务</button>
          )}
        </div>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>服务状态</h4>
          <div className="server-status">
            <span className={`status-indicator ${serverRunning ? 'running' : 'stopped'}`}>
              {serverRunning ? '● 运行中' : '○ 已停止'}
            </span>
            <div className="form-row" style={{ maxWidth: '200px', marginTop: '8px' }}>
              <label>端口号</label>
              <input
                type="number"
                value={serverPort}
                onChange={(e) => setServerPort(Number(e.target.value))}
                disabled={serverRunning}
              />
            </div>
          </div>
        </div>

        <div className="tool-section">
          <div className="section-header">
            <h4>Mock 规则 ({rules.filter(r => r.enabled).length}/{rules.length})</h4>
            <button onClick={addRule} className="btn-secondary">+ 添加规则</button>
          </div>

          <div className="rules-list">
            {rules.map(rule => (
              <div key={rule.id} className={`rule-item ${!rule.enabled ? 'disabled' : ''}`}>
                <div className="rule-info">
                  <span className={`method-tag ${rule.method}`}>{rule.method}</span>
                  <span className="rule-path">{rule.path}</span>
                  <span className="status-code">{rule.status}</span>
                  {rule.delay > 0 && <span className="delay-tag">延迟 {rule.delay}ms</span>}
                </div>
                <div className="rule-actions">
                  <button onClick={() => toggleRule(rule.id)} className="btn-secondary">
                    {rule.enabled ? '禁用' : '启用'}
                  </button>
                  <button onClick={() => { setEditingRule(rule); setShowForm(true) }} className="btn-secondary">编辑</button>
                  <button onClick={() => deleteRule(rule.id)} className="btn-danger">删除</button>
                </div>
              </div>
            ))}
            {rules.length === 0 && (
              <div className="empty-state">
                <p>暂无 Mock 规则，点击上方按钮添加</p>
              </div>
            )}
          </div>
        </div>

        {showForm && editingRule && (
          <div className="tool-section form-panel">
            <h4>编辑规则</h4>
            <div className="form-row">
              <label>请求方法</label>
              <select
                value={editingRule.method}
                onChange={(e) => setEditingRule({ ...editingRule, method: e.target.value })}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
                <option value="PATCH">PATCH</option>
              </select>
            </div>
            <div className="form-row">
              <label>路径</label>
              <input
                type="text"
                value={editingRule.path}
                onChange={(e) => setEditingRule({ ...editingRule, path: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>状态码</label>
              <input
                type="number"
                value={editingRule.status}
                onChange={(e) => setEditingRule({ ...editingRule, status: Number(e.target.value) })}
              />
            </div>
            <div className="form-row">
              <label>延迟 (ms)</label>
              <input
                type="number"
                value={editingRule.delay}
                onChange={(e) => setEditingRule({ ...editingRule, delay: Number(e.target.value) })}
              />
            </div>
            <div className="form-row">
              <label>响应体</label>
              <textarea
                value={editingRule.body}
                onChange={(e) => setEditingRule({ ...editingRule, body: e.target.value })}
                rows={6}
              />
            </div>
            <div className="form-actions">
              <button onClick={saveRule}>保存</button>
              <button onClick={() => { setShowForm(false); setEditingRule(null) }} className="btn-secondary">取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
