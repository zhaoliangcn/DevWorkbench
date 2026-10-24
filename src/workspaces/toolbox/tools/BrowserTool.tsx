import { useEffect, useState } from 'react'
import { electronAPI } from '../utils/electron'
import { toPngDataUrl } from './pure/browser'

interface SessionInfo {
  id: string
  channel: string
  title: string
  url: string
}

/** Playwright 浏览器（路线 B：playwright-core 驱动本机 Edge/Chrome，零浏览器二进制下载） */
export function BrowserTool() {
  const [browseUrl, setBrowseUrl] = useState('https://')
  const [browseOpen, setBrowseOpen] = useState(false)
  const [autoUrl, setAutoUrl] = useState('https://')
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [clickSelector, setClickSelector] = useState('')
  const [fillSelector, setFillSelector] = useState('')
  const [fillValue, setFillValue] = useState('')
  const [textResult, setTextResult] = useState('')
  const [shotDataUrl, setShotDataUrl] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const pushLog = (msg: string) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    setLogs((prev) => [`[${time}] ${msg}`, ...prev].slice(0, 50))
  }

  // 挂载时恢复会话状态（主进程会话在工具切换期间保持）
  useEffect(() => {
    void electronAPI.browserStatus().then((s) => {
      setBrowseOpen(s.browseWindowOpen)
      const active = s.sessions.find((x) => x.id === s.activeId) ?? s.sessions[0]
      if (active) setSession(active)
    })
  }, [])

  const guard = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const openBrowse = () =>
    guard(async () => {
      const r = await electronAPI.browserOpenBrowseWindow(browseUrl)
      if (r.success) {
        setBrowseOpen(true)
        pushLog(`已打开浏览窗口：${browseUrl}`)
      } else {
        pushLog(`打开浏览窗口失败：${r.error}`)
      }
    })

  const closeBrowse = () =>
    guard(async () => {
      await electronAPI.browserCloseBrowseWindow()
      setBrowseOpen(false)
      pushLog('已关闭浏览窗口')
    })

  const launchOrNavigate = () =>
    guard(async () => {
      if (session) {
        const r = await electronAPI.browserNavigate(session.id, autoUrl)
        if (r.success) {
          setSession({ ...session, url: r.url ?? autoUrl, title: r.title ?? '' })
          pushLog(`导航成功：${r.url}（${r.title}）`)
        } else {
          pushLog(`导航失败：${r.error}`)
        }
        return
      }
      const r = await electronAPI.browserLaunch(autoUrl)
      if (r.success && r.sessionId) {
        setSession({ id: r.sessionId, channel: r.channel ?? '', title: r.title ?? '', url: autoUrl })
        pushLog(`会话已启动（通道 ${r.channel}）：${autoUrl}`)
      } else {
        pushLog(`启动失败：${r.error}`)
      }
    })

  const doClick = () =>
    guard(async () => {
      if (!session) return
      const r = await electronAPI.browserClick(session.id, clickSelector)
      pushLog(r.success ? `点击成功：${clickSelector}` : `点击失败：${r.error}`)
    })

  const doFill = () =>
    guard(async () => {
      if (!session) return
      const r = await electronAPI.browserFill(session.id, fillSelector, fillValue)
      pushLog(r.success ? `填值成功：${fillSelector}` : `填值失败：${r.error}`)
    })

  const fetchText = () =>
    guard(async () => {
      if (!session) return
      const r = await electronAPI.browserText(session.id)
      if (r.success && r.text !== undefined) {
        setTextResult(r.text)
        pushLog(`抓取文本 ${r.text.length} 字符`)
      } else {
        pushLog(`抓取失败：${r.error}`)
      }
    })

  const takeShot = () =>
    guard(async () => {
      if (!session) return
      const r = await electronAPI.browserScreenshot(session.id)
      if (r.success && r.pngBase64) {
        setShotDataUrl(toPngDataUrl(r.pngBase64))
        pushLog('截图成功')
      } else {
        pushLog(`截图失败：${r.error}`)
      }
    })

  const closeSession = () =>
    guard(async () => {
      if (!session) return
      await electronAPI.browserClose(session.id)
      pushLog(`会话已关闭：${session.id}`)
      setSession(null)
      setTextResult('')
      setShotDataUrl(null)
    })

  const copyTextResult = async () => {
    const ok = await electronAPI.copyText(textResult)
    pushLog(ok ? '已复制到剪贴板' : '复制失败')
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>Playwright 浏览器</h3>
        {session && (
          <span className="browser-session-badge">
            {session.channel} · {session.id}
            {session.title ? ` · ${session.title}` : ''}
          </span>
        )}
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>浏览窗口</h4>
          <p className="browser-hint">独立浏览器窗口（无应用桥接，适合日常网页浏览与调试）</p>
          <div className="tool-actions browser-row">
            <input
              type="text"
              value={browseUrl}
              onChange={(e) => setBrowseUrl(e.target.value)}
              placeholder="https://example.com"
              className="calc-input"
              style={{ flex: 1 }}
            />
            <button onClick={openBrowse} disabled={busy || !browseUrl.trim()}>打开</button>
            <button onClick={closeBrowse} disabled={busy || !browseOpen} className="btn-secondary">关闭窗口</button>
          </div>
        </div>

        <div className="tool-section">
          <h4>自动化会话（headless）</h4>
          <div className="tool-actions browser-row">
            <input
              type="text"
              value={autoUrl}
              onChange={(e) => setAutoUrl(e.target.value)}
              placeholder="https://example.com"
              className="calc-input"
              style={{ flex: 1 }}
            />
            <button onClick={launchOrNavigate} disabled={busy || !autoUrl.trim()}>
              {session ? '导航' : '启动会话'}
            </button>
            <button onClick={closeSession} disabled={busy || !session} className="btn-secondary">关闭会话</button>
          </div>
          <div className="browser-actions-grid">
            <div className="tool-actions browser-row">
              <input
                type="text"
                value={clickSelector}
                onChange={(e) => setClickSelector(e.target.value)}
                placeholder="点击目标选择器，如 #submit"
                className="calc-input"
                style={{ flex: 1 }}
              />
              <button onClick={doClick} disabled={busy || !session || !clickSelector.trim()}>点击</button>
            </div>
            <div className="tool-actions browser-row">
              <input
                type="text"
                value={fillSelector}
                onChange={(e) => setFillSelector(e.target.value)}
                placeholder="输入框选择器，如 #search"
                className="calc-input"
                style={{ flex: 1 }}
              />
              <input
                type="text"
                value={fillValue}
                onChange={(e) => setFillValue(e.target.value)}
                placeholder="填入内容"
                className="calc-input"
                style={{ flex: 1 }}
              />
              <button onClick={doFill} disabled={busy || !session || !fillSelector.trim()}>填值</button>
            </div>
            <div className="tool-actions browser-row">
              <button onClick={fetchText} disabled={busy || !session}>抓取文本</button>
              <button onClick={takeShot} disabled={busy || !session}>截图</button>
            </div>
          </div>
        </div>

        {textResult && (
          <div className="tool-section">
            <h4>
              抓取结果
              <button onClick={copyTextResult} className="btn-secondary browser-copy-btn">复制</button>
            </h4>
            <div className="result-display browser-text-result">
              <pre>{textResult}</pre>
            </div>
          </div>
        )}

        {shotDataUrl && (
          <div className="tool-section">
            <h4>截图预览</h4>
            <img src={shotDataUrl} alt="页面截图" className="browser-shot" />
          </div>
        )}

        <div className="tool-section">
          <h4>操作日志</h4>
          <div className="browser-log">
            {logs.length === 0 ? <span className="browser-log-empty">暂无操作</span> : logs.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
