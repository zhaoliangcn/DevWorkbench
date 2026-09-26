// 会话历史浮层（切片 F，C.8 dsh 借鉴：Trajectory append-only 事件流查看）。
// 数据来自主进程 assistant:history:*（dev-assistant-ts SessionStore 静态 API）。
import { useState, useEffect, useCallback } from 'react'
import { X, RefreshCw, Trash2, FileText } from 'lucide-react'
import { assistantAPI } from './utils/electron'

interface HistorySession {
  sessionId: string
  file: string
  mtimeMs: number
  size: number
}

/** sessionId 形如 2026-09-26T11-38-10-597-e3d5fa8d，取时间部分做短标签 */
function sessionLabel(id: string): string {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/)
  return m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]}` : id
}

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString()
}

function EventRow({ event }: { event: AssistantHistoryEvent }) {
  switch (event.type) {
    case 'user_message':
      return (
        <div className="sh-msg user">
          <span className="sh-time">{formatTime(event.timestamp)}</span>
          <p>{event.content}</p>
        </div>
      )
    case 'assistant_message':
      return (
        <div className="sh-msg assistant">
          <span className="sh-time">{formatTime(event.timestamp)}</span>
          <p>{event.content}</p>
        </div>
      )
    case 'tool_call_request':
      return (
        <div className="sh-tool">
          <span className="sh-time">{formatTime(event.timestamp)}</span>
          <code className="sh-tool-name">⚙ {event.name}</code>
          <pre className="sh-tool-args">{JSON.stringify(event.arguments, null, 2)}</pre>
        </div>
      )
    case 'tool_result':
      return (
        <div className={`sh-tool ${event.success ? 'ok' : 'fail'}`}>
          <span className="sh-time">{formatTime(event.timestamp)}</span>
          <code className="sh-tool-name">{event.success ? '✓' : '✗'} {event.name}</code>
          <pre className="sh-tool-args">{event.content}</pre>
        </div>
      )
    case 'context_compression':
      return (
        <div className="sh-system">
          <span className="sh-time">{formatTime(event.timestamp)}</span>
          上下文压缩 {event.beforeTokens} → {event.afterTokens} tokens
        </div>
      )
    case 'summary_saved':
      return (
        <div className="sh-system">
          <span className="sh-time">{formatTime(event.timestamp)}</span>
          摘要 L{event.level}：{event.content}
        </div>
      )
    default:
      return (
        <div className="sh-system">
          <span className="sh-time">{formatTime(event.timestamp)}</span>
          {event.content}
        </div>
      )
  }
}

export function SessionHistory({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<HistorySession[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [events, setEvents] = useState<AssistantHistoryEvent[]>([])
  const [error, setError] = useState('')

  const loadList = useCallback(async () => {
    const res = await assistantAPI.historyList()
    // setState 均在 await 之后（异步回调），避免同步级联渲染
    setError(res.success ? '' : (res.error ?? '加载会话列表失败'))
    setSessions(res.sessions)
  }, [])

  // 装载外部系统（主进程 IPC）数据，setState 全部发生在 await 之后，属规则误报
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadList()
  }, [loadList])
  /* eslint-enable react-hooks/set-state-in-effect */

  const openSession = async (file: string) => {
    setError('')
    const res = await assistantAPI.historyRead(file)
    if (!res.success) {
      setError(res.error ?? '读取会话失败')
      return
    }
    setActiveFile(file)
    setEvents(res.events)
  }

  const deleteSession = async (file: string) => {
    const res = await assistantAPI.historyDelete(file)
    if (!res.success) {
      setError(res.error ?? '删除失败')
      return
    }
    if (activeFile === file) {
      setActiveFile(null)
      setEvents([])
    }
    void loadList()
  }

  return (
    <div className="sh-overlay">
      <div className="sh-panel">
        <div className="sh-head">
          <FileText size={14} />
          <span>会话历史</span>
          <div className="sh-head-actions">
            <button className="assistant-btn" onClick={() => void loadList()} title="刷新">
              <RefreshCw size={12} />
            </button>
            <button className="assistant-btn" onClick={onClose} title="关闭">
              <X size={12} />
            </button>
          </div>
        </div>
        {error && <div className="assistant-banner-error">{error}</div>}
        <div className="sh-body">
          <div className="sh-list">
            {sessions.length === 0 && <p className="sh-empty">暂无历史会话</p>}
            {sessions.map((s) => (
              <div
                key={s.file}
                className={`sh-item ${activeFile === s.file ? 'active' : ''}`}
                onClick={() => void openSession(s.file)}
              >
                <span className="sh-item-label">{sessionLabel(s.sessionId)}</span>
                <span className="sh-item-meta">
                  {formatSize(s.size)}
                  <button
                    className="sh-item-del"
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteSession(s.file)
                    }}
                    title="删除会话"
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              </div>
            ))}
          </div>
          <div className="sh-detail">
            {!activeFile && <p className="sh-empty">选择左侧会话查看事件流</p>}
            {activeFile && events.length === 0 && <p className="sh-empty">该会话没有事件记录</p>}
            {events.map((e, i) => (
              <EventRow key={i} event={e} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
