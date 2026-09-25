import { useState } from 'react'
import type { EnvInfo, PortInfo } from '../../../types/toolbox'
import { electronAPI } from '../utils/electron'

export function SystemModule() {
  const [envResults, setEnvResults] = useState<EnvInfo[]>([])
  const [checking, setChecking] = useState(false)
  const [portInput, setPortInput] = useState('')
  const [portResult, setPortResult] = useState<PortInfo | null>(null)
  const [killing, setKilling] = useState(false)

  const envTypes = [
    { id: 'java', name: 'Java' },
    { id: 'python', name: 'Python' },
    { id: 'node', name: 'Node.js' },
    { id: 'go', name: 'Go' },
  ]

  const checkAllEnv = async () => {
    setChecking(true)
    const results: EnvInfo[] = []
    for (const env of envTypes) {
      const info = await electronAPI.checkEnv(env.id)
      results.push({ ...info, name: env.name })
    }
    setEnvResults(results)
    setChecking(false)
  }

  const checkPort = async () => {
    const port = parseInt(portInput)
    if (isNaN(port) || port < 1 || port > 65535) return
    const result = await electronAPI.checkPort(port)
    setPortResult(result as PortInfo | null)
  }

  const killProcess = async (pid: number) => {
    if (!pid) return
    setKilling(true)
    const success = await electronAPI.killProcess(pid)
    if (success) {
      setPortResult(null)
    }
    setKilling(false)
  }

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>系统检测</h3>
      </div>
      <div className="module-body">
        <div className="tool-section">
          <h4>开发环境检测</h4>
          <button onClick={checkAllEnv} disabled={checking}>
            {checking ? '检测中...' : '检测所有环境'}
          </button>
          {envResults.length > 0 && (
            <div className="env-list">
              {envResults.map((env) => (
                <div key={env.name} className={`env-item ${env.installed ? 'installed' : 'not-installed'}`}>
                  <span className="env-name">{env.name}</span>
                  <span className="env-status">
                    {env.installed ? (env.version || '已安装') : '未安装'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="tool-section">
          <h4>端口占用检测</h4>
          <div className="inline-check-label port-input-row">
            <input
              type="number"
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              placeholder="输入端口号 (1-65535)"
              min="1"
              max="65535"
            />
            <button onClick={checkPort} disabled={!portInput}>检测</button>
          </div>
          {portResult && (
            <div className="port-result">
              <p>端口 {portResult.port} 被占用</p>
              <p>进程: {portResult.processName || '未知'} (PID: {portResult.pid})</p>
              <p>协议: {portResult.protocol} | 状态: {portResult.state || '未知'}</p>
              {portResult.pid && (
                <button onClick={() => killProcess(portResult.pid!)} disabled={killing}>
                  {killing ? '结束中...' : '结束进程'}
                </button>
              )}
            </div>
          )}
          {portInput && !portResult && (
            <div className="port-result success">
              <p>端口 {portInput} 未被占用</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
