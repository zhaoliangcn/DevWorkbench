import { useState, useEffect, useRef } from 'react'
import type { SSHConfig } from '../../../types/toolbox'
import { useAppStore } from '../../../store/appStore'
import { electronAPI } from '../utils/electron'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

type SshTabStatus = 'connecting' | 'connected' | 'error' | 'closed'

/** 一个 tab = 一条独立 SSH 连接 + 独立 xterm 实例（输出 buffer 随 tab 保留） */
interface SshTab {
  id: string
  server: SSHConfig
  term: Terminal
  fit: FitAddon
  /** term 是否已 open 到 DOM（xterm 同一实例仅允许 open 一次） */
  opened: boolean
  status: SshTabStatus
  error?: string
  observer?: ResizeObserver
}

const TERM_THEME = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#cccccc',
  selectionBackground: 'rgba(255, 255, 255, 0.3)',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
}

function createTerm(): Terminal {
  return new Terminal({
    cursorBlink: useAppStore.getState().cursorBlink,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: TERM_THEME,
  })
}

// 模块级辅助：react-compiler 将组件内函数体中的 Date.now/Math.random
// 视为「渲染期不纯调用」，抽到组件外规避误报
function genServerId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function nowMs(): number {
  return Date.now()
}

/** 连接 id：ssh-<36 进制时间戳>-<随机后缀>，防同毫秒冲突 */
function genConnectionId(): string {
  return `ssh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function SSHModule() {
  const [servers, setServers] = useState<SSHConfig[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  /** 正在编辑的服务器 id；null = 新增模式（表单复用） */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newServer, setNewServer] = useState<Partial<SSHConfig>>({
    name: '',
    host: '',
    port: 22,
    username: '',
    password: '',
  })
  const [tabs, setTabs] = useState<SshTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  /** tabs 的同步镜像：异步回调（connect/close/resize）里读最新值、防竞态 */
  const tabsRef = useRef<SshTab[]>([])
  const activeTabIdRef = useRef<string | null>(null)
  /** 各 tab 终端挂载点（.terminal-window） */
  const tabElsRef = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  // ---------- 服务器配置管理（添加/编辑/删除） ----------

  const resetForm = () => {
    setShowAddForm(false)
    setEditingId(null)
    setNewServer({ name: '', host: '', port: 22, username: '', password: '' })
  }

  /** 编辑已有配置：复用添加表单，回填后保存替换原项 */
  const startEdit = (server: SSHConfig) => {
    setEditingId(server.id)
    setNewServer({
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
      password: server.password ?? '',
    })
    setShowAddForm(true)
  }

  const saveServer = async () => {
    if (!newServer.name || !newServer.host || !newServer.username) return
    const name = newServer.name
    const host = newServer.host
    const username = newServer.username
    let updated: SSHConfig[]
    if (editingId) {
      // 编辑：保持 id 与 createdAt，其余字段以表单为准
      updated = servers.map((s) =>
        s.id === editingId
          ? {
              ...s,
              name,
              host,
              port: newServer.port || 22,
              username,
              password: newServer.password,
              updatedAt: nowMs(),
            }
          : s,
      )
    } else {
      const server: SSHConfig = {
        id: genServerId(),
        name,
        host,
        port: newServer.port || 22,
        username,
        password: newServer.password,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      }
      updated = [...servers, server]
    }
    setServers(updated)
    await electronAPI.saveData('servers', {
      groups: [{ id: 'default', name: '默认分组', servers: updated }],
    })
    // 已打开的 tab 引用旧配置对象，同步替换为编辑后配置（重连时生效）
    tabsRef.current = tabsRef.current.map((t) => {
      const next = updated.find((s) => s.id === t.server.id)
      return next ? { ...t, server: next } : t
    })
    setTabs(tabsRef.current)
    resetForm()
  }

  const deleteServer = async (id: string) => {
    const updated = servers.filter((s) => s.id !== id)
    setServers(updated)
    await electronAPI.saveData('servers', {
      groups: [{ id: 'default', name: '默认分组', servers: updated }],
    })
    if (editingId === id) resetForm()
  }

  // ---------- 多 tab 连接管理 ----------

  const updateTab = (id: string, patch: Partial<SshTab>) => {
    tabsRef.current = tabsRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t))
    setTabs(tabsRef.current)
  }

  /** 连接流程：connect → openShell → 注册监听。tab 在 await 期间被关闭则中断 */
  const connectTab = async (id: string) => {
    const tab = tabsRef.current.find((t) => t.id === id)
    if (!tab) return
    const { server } = tab
    try {
      const connectResult = await electronAPI.sshConnect(id, {
        host: server.host,
        port: server.port,
        username: server.username,
        password: server.password,
      })
      if (!tabsRef.current.some((t) => t.id === id)) {
        if (connectResult.success) void electronAPI.sshDisconnect(id)
        return
      }
      if (!connectResult.success) {
        updateTab(id, { status: 'error', error: connectResult.error || '连接失败' })
        return
      }
      const { cols, rows } = tab.term
      const shellResult = await electronAPI.sshOpenShell(id, cols, rows)
      if (!tabsRef.current.some((t) => t.id === id)) {
        void electronAPI.sshDisconnect(id)
        return
      }
      if (!shellResult.success) {
        updateTab(id, { status: 'error', error: '无法打开 Shell' })
        return
      }
      electronAPI.onShellData(id, (data: string) => tab.term.write(data))
      electronAPI.onShellError(id, (error: string) => {
        tab.term.write(`\r\n\x1b[31m错误: ${error}\x1b[0m\r\n`)
      })
      electronAPI.onShellClose(id, () => {
        tab.term.write('\r\n\x1b[33m连接已关闭\x1b[0m\r\n')
        updateTab(id, { status: 'closed' })
      })
      updateTab(id, { status: 'connected' })
      tab.term.focus()
    } catch (error) {
      updateTab(id, { status: 'error', error: (error as Error).message })
    }
  }

  /** 打开新连接 tab；同一服务器已有活跃 tab 时仅激活（避免重复连接） */
  const openConnection = (server: SSHConfig) => {
    const existed = tabsRef.current.find(
      (t) => t.server.id === server.id && (t.status === 'connected' || t.status === 'connecting'),
    )
    if (existed) {
      setActiveTabId(existed.id)
      return
    }
    const id = genConnectionId()
    const term = createTerm()
    term.onData((data) => {
      void electronAPI.sshShellWrite(id, data)
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const tab: SshTab = { id, server, term, fit, opened: false, status: 'connecting' }
    tabsRef.current = [...tabsRef.current, tab]
    setTabs(tabsRef.current)
    setActiveTabId(id)
  }

  /** 关闭 tab：断开连接、释放终端、激活相邻 tab */
  const closeTab = (id: string) => {
    const t = tabsRef.current.find((x) => x.id === id)
    if (!t) return
    t.observer?.disconnect()
    void electronAPI.sshDisconnect(id)
    try {
      t.term.dispose()
    } catch {
      // 已释放，忽略
    }
    const idx = tabsRef.current.findIndex((x) => x.id === id)
    tabsRef.current = tabsRef.current.filter((x) => x.id !== id)
    setTabs(tabsRef.current)
    delete tabElsRef.current[id]
    if (activeTabIdRef.current === id) {
      const next = tabsRef.current[Math.min(idx, tabsRef.current.length - 1)]
      setActiveTabId(next?.id ?? null)
    }
  }

  // tab 渲染后把未挂载的 term open 到 DOM 并发起连接（xterm 仅可 open 一次，用 opened 防重入）
  useEffect(() => {
    for (const t of tabsRef.current) {
      const el = tabElsRef.current[t.id]
      if (t.opened || !el) continue
      t.term.open(el)
      t.fit.fit()
      const observer = new ResizeObserver(() => {
        // 非活动 tab 的容器 display:none 会产生尺寸抖动，只在活动时 fit
        if (activeTabIdRef.current !== t.id) return
        t.fit.fit()
        if (t.term.cols > 0) void electronAPI.sshShellResize(t.id, t.term.cols, t.term.rows)
      })
      observer.observe(el)
      t.observer = observer
      t.opened = true
      void connectTab(t.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs])

  // 切换 tab：显示后重新 fit 并同步远端尺寸（display:none 期间 fit 结果无效）
  useEffect(() => {
    if (!activeTabId) return
    const t = tabsRef.current.find((x) => x.id === activeTabId)
    if (!t?.opened) return
    const raf = requestAnimationFrame(() => {
      t.fit.fit()
      if (t.term.cols > 0) void electronAPI.sshShellResize(t.id, t.term.cols, t.term.rows)
      t.term.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [activeTabId, tabs])

  // ---------- 生命周期 ----------

  useEffect(() => {
    ;(async () => {
      const data = await electronAPI.loadData('servers') as { groups?: { servers: SSHConfig[] }[] } | null
      if (data?.groups) {
        setServers(data.groups.flatMap((g) => g.servers))
      }
    })()
    return () => {
      // Activity 保活（附录 D P1）：hidden 触发的 cleanup 执行时 activeWorkspace
      // 已切走 —— 此情形不断开，保留后台 SSH 会话；仅当仍处于工具箱
      // （真卸载，如错误边界重试）时才释放全部连接
      if (useAppStore.getState().activeWorkspace === 'toolbox') {
        for (const t of tabsRef.current) {
          t.observer?.disconnect()
          void electronAPI.sshDisconnect(t.id)
          try {
            t.term.dispose()
          } catch {
            // 已释放，忽略
          }
        }
        tabsRef.current = []
      }
    }
  }, [])

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>SSH 终端</h3>
        <div className="module-actions">
          <button
            onClick={() => {
              // 编辑中再点「添加」：切回新增模式，清空回填值
              if (showAddForm && editingId) resetForm()
              else setShowAddForm(true)
            }}
            className="btn-secondary"
          >
            添加服务器
          </button>
        </div>
      </div>
      <div className="module-body">
        {showAddForm && (
          <div className="form-panel">
            <h4>{editingId ? '编辑服务器' : '添加服务器'}</h4>
            <div className="form-row">
              <label>名称</label>
              <input
                type="text"
                value={newServer.name}
                onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                placeholder="服务器名称"
              />
            </div>
            <div className="form-row">
              <label>主机</label>
              <input
                type="text"
                value={newServer.host}
                onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                placeholder="192.168.1.100"
              />
            </div>
            <div className="form-row">
              <label>端口</label>
              <input
                type="number"
                value={newServer.port}
                onChange={(e) => setNewServer({ ...newServer, port: parseInt(e.target.value) })}
              />
            </div>
            <div className="form-row">
              <label>用户名</label>
              <input
                type="text"
                value={newServer.username}
                onChange={(e) => setNewServer({ ...newServer, username: e.target.value })}
                placeholder="root"
              />
            </div>
            <div className="form-row">
              <label>密码</label>
              <input
                type="password"
                value={newServer.password}
                onChange={(e) => setNewServer({ ...newServer, password: e.target.value })}
                placeholder="密码"
              />
            </div>
            <div className="form-actions">
              <button onClick={saveServer}>{editingId ? '保存修改' : '保存'}</button>
              <button onClick={resetForm} className="btn-secondary">
                取消
              </button>
            </div>
          </div>
        )}

        <div className="server-list">
          {servers.length === 0 && !showAddForm && (
            <div className="empty-state">
              <p>暂无服务器，点击"添加服务器"开始</p>
            </div>
          )}
          {servers.map((server) => {
            const opened = tabs.find(
              (t) => t.server.id === server.id && (t.status === 'connected' || t.status === 'connecting'),
            )
            return (
              <div key={server.id} className="server-item">
                <div className="server-info">
                  <span className="server-name">{server.name}</span>
                  <span className="server-host">
                    {server.host}:{server.port}
                  </span>
                  <span className="server-user">{server.username}</span>
                </div>
                <div className="server-actions">
                  <button onClick={() => openConnection(server)}>{opened ? '回到终端' : '连接'}</button>
                  <button onClick={() => startEdit(server)} className="btn-secondary">
                    编辑
                  </button>
                  <button onClick={() => deleteServer(server.id)} className="btn-danger">
                    删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {tabs.length > 0 && (
          <div className="ssh-tabs">
            {tabs.map((t) => (
              <div
                key={t.id}
                className={`ssh-tab${t.id === activeTabId ? ' active' : ''}`}
                onClick={() => setActiveTabId(t.id)}
                title={`${t.server.name} (${t.server.host}:${t.server.port})`}
              >
                <span className="ssh-tab-status-dot" data-status={t.status} />
                <span className="ssh-tab-title">{t.server.name}</span>
                <button
                  className="ssh-tab-close"
                  title="关闭连接"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {tabs.map((t) => (
          <div
            key={t.id}
            className="terminal-container"
            style={{ display: t.id === activeTabId ? undefined : 'none' }}
          >
            <div className="terminal-header">
              <span>
                {t.server.name} ({t.server.host}:{t.server.port})
              </span>
              <div className="terminal-actions">
                {t.status === 'connecting' && <span className="connecting-indicator">连接中...</span>}
                <button onClick={() => closeTab(t.id)} className="btn-secondary">
                  关闭
                </button>
              </div>
            </div>
            {(t.status === 'error' || t.status === 'closed') && (
              <div className="connection-error">
                <p>{t.status === 'error' ? (t.error || '连接失败') : '连接已关闭'}</p>
                <div className="server-actions">
                  <button
                    onClick={() => {
                      closeTab(t.id)
                      openConnection(t.server)
                    }}
                    className="btn-secondary"
                  >
                    重新连接
                  </button>
                  <button onClick={() => closeTab(t.id)} className="btn-secondary">
                    关闭标签页
                  </button>
                </div>
              </div>
            )}
            <div
              ref={(el) => {
                tabElsRef.current[t.id] = el
              }}
              className="terminal-window"
              style={{
                display: t.status === 'connected' || t.status === 'connecting' ? undefined : 'none',
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
