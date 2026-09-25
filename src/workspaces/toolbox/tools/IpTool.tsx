import { useState, useEffect } from 'react'
import { electronAPI } from '../utils/electron'

export function IpTool() {
  const [publicIp, setPublicIp] = useState('')
  const [localIps, setLocalIps] = useState<string[]>([])
  const [scanHost, setScanHost] = useState('')
  const [scanStartPort, setScanStartPort] = useState(1)
  const [scanEndPort, setScanEndPort] = useState(1024)
  const [openPorts, setOpenPorts] = useState<number[]>([])
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState(false)

  const getPublicIp = async () => {
    setLoading(true)
    try {
      const response = await fetch('https://api.ipify.org')
      const ip = await response.text()
      setPublicIp(ip)
    } catch {
      setPublicIp('获取失败，请检查网络连接')
    } finally {
      setLoading(false)
    }
  }

  const scanPorts = async () => {
    setScanning(true)
    setOpenPorts([])
    for (let port = scanStartPort; port <= scanEndPort; port++) {
      try {
        const open = await electronAPI.scanPort(scanHost, port)
        if (open) setOpenPorts((prev) => [...prev, port])
      } catch {
        // port closed
      }
    }
    setScanning(false)
  }

  useEffect(() => {
    ;(async () => {
      try {
        setLocalIps(await electronAPI.getLocalIps())
      } catch {
        setLocalIps(['获取本地 IP 失败'])
      }
    })()
  }, [])

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>IP/域名工具箱</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>公网IP查询</h4>
          <div className="result-display">
            <textarea
              value={publicIp}
              readOnly
              rows={1}
              placeholder="点击查询获取公网IP"
            />
            <button onClick={getPublicIp} disabled={loading}>
              {loading ? '查询中...' : '查询'}
            </button>
          </div>
        </div>

        <div className="tool-section">
          <h4>内网IP</h4>
          <div className="result-display">
            <textarea
              value={localIps.join('\n')}
              readOnly
              rows={3}
              placeholder="内网IP列表"
            />
          </div>
        </div>

        <div className="tool-section">
          <h4>端口扫描</h4>
          <div className="form-row">
            <label>目标主机</label>
            <input
              type="text"
              value={scanHost}
              onChange={(e) => setScanHost(e.target.value)}
              placeholder="例如: 192.168.1.1"
            />
          </div>
          <div className="form-row">
            <label>端口范围</label>
            <div className="scan-range-row">
              <input
                type="number"
                value={scanStartPort}
                onChange={(e) => setScanStartPort(Number(e.target.value))}
                placeholder="起始端口"
              />
              <input
                type="number"
                value={scanEndPort}
                onChange={(e) => setScanEndPort(Number(e.target.value))}
                placeholder="结束端口"
              />
            </div>
          </div>
          <button onClick={scanPorts} disabled={!scanHost || scanning}>
            {scanning ? '扫描中...' : '扫描端口'}
          </button>

          {openPorts.length > 0 && (
            <div className="result-display scan-result">
              <textarea
                value={openPorts.join(', ')}
                readOnly
                rows={3}
                placeholder="开放端口"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
