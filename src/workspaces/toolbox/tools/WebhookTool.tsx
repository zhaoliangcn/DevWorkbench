import { useState, useEffect } from 'react'
import { electronAPI } from '../utils/electron'
import { useStore as useKnowledgeStore } from '../../../store/knowledgeStore'

interface WebhookEvent {
  id: string
  method: string
  path: string
  headers: Record<string, string>
  body: string
  receivedAt: number
}

/** 附录 F F.3：Webhook 接收器工具 */
export function WebhookTool() {
  const [listening, setListening] = useState(false)
  const [port, setPort] = useState<number | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)

  useEffect(() => {
    void electronAPI.webhookList().then((s) => {
      setListening(s.listening)
      setPort(s.port)
      setEnabled(s.enabled)
      setEvents(s.events)
    })
    // 实时推送（环形 buffer 由主进程维护，这里追加本地视图）
    const off = electronAPI.onWebhookReceived((ev) => {
      setEvents((prev) => [...prev, ev].slice(-100))
    })
    return off
  }, [])

  const toggle = async () => {
    setError('')
    const r = await electronAPI.webhookSetEnabled(!enabled)
    setListening(r.listening)
    setPort(r.port)
    setEnabled(r.enabled)
    if (r.error) setError(r.error)
  }

  const clear = async () => {
    await electronAPI.webhookClear()
    setEvents([])
  }

  const saveAsNote = (ev: WebhookEvent) => {
    const time = new Date(ev.receivedAt).toLocaleString()
    const title = `Webhook ${ev.method} ${ev.path.split('?')[0]}`
    const content = [
      `# Webhook ${ev.method} ${ev.path}`,
      '',
      `- 时间：${time}`,
      `- 方法：${ev.method}`,
      `- 路径：${ev.path}`,
      `- #webhook`,
      '',
      '## Headers',
      '',
      '```json',
      JSON.stringify(ev.headers, null, 2),
      '```',
      '',
      '## Body',
      '',
      '```json',
      ev.body || '(空)',
      '```',
    ].join('\n')
    useKnowledgeStore.getState().importNote(title, content)
    setSavedId(ev.id)
    window.setTimeout(() => setSavedId(null), 2000)
  }

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>Webhook 接收</h3>
        <button className={enabled ? 'btn-danger' : 'btn-secondary'} onClick={() => void toggle()}>
          {listening ? '停止监听' : '启动监听'}
        </button>
      </div>
      <div className="module-body">
        <div className="webhook-status">
          {listening ? (
            <span className="webhook-url">
              监听中：http://127.0.0.1:{port}/webhook/&lt;name&gt;
              <button
                className="btn-secondary"
                onClick={() => port && navigator.clipboard.writeText(`http://127.0.0.1:${port}/webhook/test`)}
                title="复制测试地址"
              >
                复制
              </button>
            </span>
          ) : (
            <span className="panel-empty-text">
              {error ? `启动失败：${error}` : '点击「启动监听」开启本地接收端（默认 127.0.0.1:9090，冲突自增）'}
            </span>
          )}
          {events.length > 0 && (
            <button className="btn-secondary" onClick={() => void clear()}>清空</button>
          )}
        </div>

        <div className="history-list">
          {events.length === 0 && listening && (
            <p className="panel-empty-text">等待请求…可用 curl 测试：curl -X POST http://127.0.0.1:{port}/webhook/test -d &apos;{"{ \"a\": 1 }"}&apos;</p>
          )}
          {events
            .slice()
            .reverse()
            .map((ev) => {
              const expanded = expandedId === ev.id
              return (
                <div key={ev.id} className="history-item webhook-event" onClick={() => setExpandedId(expanded ? null : ev.id)}>
                  <div className="webhook-event-head">
                    <span className={`method ${ev.method}`}>{ev.method}</span>
                    <span className="url">{ev.path}</span>
                    <span className="status">{new Date(ev.receivedAt).toLocaleTimeString()}</span>
                  </div>
                  {expanded && (
                    <div className="webhook-event-detail" onClick={(e) => e.stopPropagation()}>
                      <pre className="webhook-pre">{JSON.stringify(ev.headers, null, 2)}</pre>
                      <div className="section-title">Body</div>
                      <pre className="webhook-pre">{ev.body || '(空)'}</pre>
                      <button className="btn-secondary" onClick={() => saveAsNote(ev)}>
                        {savedId === ev.id ? '✓ 已存入知识库' : '存为笔记'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
