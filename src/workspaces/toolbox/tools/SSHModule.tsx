import { useState, useEffect, useRef } from 'react'
import type { SSHConfig } from '../../../types/toolbox'
import { useAppStore } from '../../../store/appStore'
import { electronAPI } from '../utils/electron'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export function SSHModule() {
  const [servers, setServers] = useState<SSHConfig[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [newServer, setNewServer] = useState<Partial<SSHConfig>>({
    name: '',
    host: '',
    port: 22,
    username: '',
    password: '',
  })
  const [selectedServer, setSelectedServer] = useState<SSHConfig | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const terminalRef = useRef<HTMLDivElement>(null)
  const terminalInstance = useRef<Terminal | null>(null)
  const fitAddonInstance = useRef<FitAddon | null>(null)
  const connectionIdRef = useRef('')

  const addServer = async () => {
    if (!newServer.name || !newServer.host || !newServer.username) return
    const server: SSHConfig = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: newServer.name,
      host: newServer.host,
      port: newServer.port || 22,
      username: newServer.username,
      password: newServer.password,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const updated = [...servers, server]
    setServers(updated)
    await electronAPI.saveData('servers', {
      groups: [{ id: 'default', name: '默认分组', servers: updated }],
    })
    setShowAddForm(false)
    setNewServer({ name: '', host: '', port: 22, username: '', password: '' })
  }

  const deleteServer = async (id: string) => {
    const updated = servers.filter((s) => s.id !== id)
    setServers(updated)
    await electronAPI.saveData('servers', {
      groups: [{ id: 'default', name: '默认分组', servers: updated }],
    })
  }

  const initTerminal = () => {
    if (!terminalRef.current) return

    // 清理旧实例
    if (terminalInstance.current) {
      terminalInstance.current.dispose()
      terminalInstance.current = null
    }

    const term = new Terminal({
      cursorBlink: useAppStore.getState().cursorBlink,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
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
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    fitAddon.fit()

    terminalInstance.current = term
    fitAddonInstance.current = fitAddon

    // 监听终端输入
    term.onData((data) => {
      if (connectionIdRef.current) {
        electronAPI.sshShellWrite(connectionIdRef.current, data)
      }
    })

    // 监听窗口大小变化
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonInstance.current) {
        fitAddonInstance.current.fit()
      }
      if (terminalInstance.current && connectionIdRef.current) {
        const { cols, rows } = terminalInstance.current
        electronAPI.sshShellResize(connectionIdRef.current, cols, rows)
      }
    })

    resizeObserver.observe(terminalRef.current)
  }

  const connectToServer = async (server: SSHConfig) => {
    setConnecting(true)
    setConnectionError('')

    const connectionId = `ssh-${Date.now()}`
    connectionIdRef.current = connectionId

    try {
      // 连接 SSH
      const connectResult = await electronAPI.sshConnect(connectionId, {
        host: server.host,
        port: server.port,
        username: server.username,
        password: server.password,
      })

      if (!connectResult.success) {
        setConnectionError(connectResult.error || '连接失败')
        setConnecting(false)
        return
      }

      // 打开 Shell
      const term = terminalInstance.current
      if (!term) {
        setConnectionError('终端初始化失败')
        setConnecting(false)
        return
      }

      const { cols, rows } = term
      const shellResult = await electronAPI.sshOpenShell(connectionId, cols, rows)

      if (!shellResult.success) {
        setConnectionError('无法打开 Shell')
        setConnecting(false)
        return
      }

      // 监听 Shell 数据
      electronAPI.onShellData(connectionId, (data: string) => {
        term.write(data)
      })

      electronAPI.onShellError(connectionId, (error: string) => {
        term.write(`\r\n\x1b[31m错误: ${error}\x1b[0m\r\n`)
      })

      electronAPI.onShellClose(connectionId, () => {
        term.write('\r\n\x1b[33m连接已关闭\x1b[0m\r\n')
        setConnecting(false)
      })

      setConnecting(false)
      term.focus()
    } catch (error) {
      setConnectionError((error as Error).message)
      setConnecting(false)
    }
  }

  const disconnect = () => {
    if (connectionIdRef.current) {
      electronAPI.sshDisconnect(connectionIdRef.current)
      connectionIdRef.current = ''
    }
    if (terminalInstance.current) {
      terminalInstance.current.dispose()
      terminalInstance.current = null
    }
  }

  const handleCloseTerminal = () => {
    disconnect()
    setSelectedServer(null)
    setConnectionError('')
  }

  useEffect(() => {
    ;(async () => {
      const data = await electronAPI.loadData('servers') as { groups?: { servers: SSHConfig[] }[] } | null
      if (data?.groups) {
        setServers(data.groups.flatMap((g) => g.servers))
      }
    })()
    return () => {
      disconnect()
    }
  }, [])

  useEffect(() => {
    if (selectedServer && terminalRef.current) {
      initTerminal()
      void connectToServer(selectedServer)
    }
  }, [selectedServer])

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>SSH 终端</h3>
        <div className="module-actions">
          <button onClick={() => setShowAddForm(true)} className="btn-secondary">
            添加服务器
          </button>
        </div>
      </div>
      <div className="module-body">
        {showAddForm && (
          <div className="form-panel">
            <h4>添加服务器</h4>
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
              <button onClick={addServer}>保存</button>
              <button onClick={() => setShowAddForm(false)} className="btn-secondary">
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
          {servers.map((server) => (
            <div key={server.id} className="server-item">
              <div className="server-info">
                <span className="server-name">{server.name}</span>
                <span className="server-host">
                  {server.host}:{server.port}
                </span>
                <span className="server-user">{server.username}</span>
              </div>
              <div className="server-actions">
                <button onClick={() => setSelectedServer(server)}>连接</button>
                <button onClick={() => deleteServer(server.id)} className="btn-danger">
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>

        {selectedServer && (
          <div className="terminal-container">
            <div className="terminal-header">
              <span>{selectedServer.name} ({selectedServer.host}:{selectedServer.port})</span>
              <div className="terminal-actions">
                {connecting && <span className="connecting-indicator">连接中...</span>}
                <button onClick={handleCloseTerminal} className="btn-secondary">
                  关闭
                </button>
              </div>
            </div>
            {connectionError && (
              <div className="connection-error">
                <p>{connectionError}</p>
                <button onClick={handleCloseTerminal} className="btn-secondary">
                  返回
                </button>
              </div>
            )}
            <div ref={terminalRef} className="terminal-window" />
          </div>
        )}
      </div>
    </div>
  )
}
