// 会话历史浮层（切片 F，C.8 dsh 借鉴：Trajectory append-only 事件流查看）。
// 数据来自主进程 assistant:history:*（dev-assistant-ts SessionStore 静态 API）。
import { useState, useEffect, useCallback } from 'react'
import { X, RefreshCw, Trash2, FileText, Search } from 'lucide-react'
import { assistantAPI } from './utils/electron'
import { useStore as useKnowledgeStore } from '../../store/knowledgeStore'

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
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<
    { sessionId: string; file: string; mtimeMs: number; hits: { timestamp: string; type: string; snippet: string }[] }[] | null
  >(null)
  const [branching, setBranching] = useState(false)

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

  // B.3.4 跨会话检索
  const doSearch = async () => {
    if (!query.trim()) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    setError('')
    const res = await assistantAPI.historySearch(query.trim())
    setSearching(false)
    if (!res.success) {
      setError(res.error ?? '检索失败')
      return
    }
    setSearchResults(res.results)
  }

  // B.3.4 按笔记分支：会话轨迹 → vault 笔记；pin 后经 E.7 pinnedNotes 注入新会话，形成分支上下文
  const branchToNote = async () => {
    if (!activeFile) return
    setBranching(true)
    const session = sessions.find((s) => s.file === activeFile)
    const title = `会话分支 ${sessionLabel(session?.sessionId ?? activeFile)}`
    const lines: string[] = [`# ${title}`, '', '> 由会话历史「分支为笔记」生成；固定（pin）后可作为新会话上下文。', '']
    let userCount = 0
    let toolCount = 0
    for (const ev of events) {
      if (ev.type === 'user_message') {
        userCount += 1
        lines.push(`## 用户 ${formatTime(ev.timestamp)}`, '', (ev.content ?? '').slice(0, 2000), '')
      } else if (ev.type === 'assistant_message') {
        lines.push(`**助手**：`, '', (ev.content ?? '').slice(0, 2000), '')
      } else if (ev.type === 'tool_call_request') {
        toolCount += 1
        lines.push(`- ⚙ 工具调用：\`${ev.name}\``)
      }
    }
    lines.push('', `---`, `共 ${userCount} 轮对话、${toolCount} 次工具调用。`)
    useKnowledgeStore.getState().importNote(title, lines.join('\n'))
    setBranching(false)
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
        <div className="sh-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doSearch()
            }}
            placeholder="跨会话检索…"
          />
          <button className="assistant-btn" onClick={() => void doSearch()} title="检索">
            <Search size={12} />
            {searching ? '…' : '检索'}
          </button>
          {searchResults && (
            <button className="assistant-btn" onClick={() => setSearchResults(null)} title="返回会话列表">
              返回
            </button>
          )}
        </div>
        {error && <div className="assistant-banner-error">{error}</div>}
        <div className="sh-body">
          <div className="sh-list">
            {searchResults ? (
              searchResults.length === 0 ? (
                <p className="sh-empty">无匹配会话</p>
              ) : (
                searchResults.map((r) => (
                  <div key={r.file} className="sh-item" onClick={() => void openSession(r.file)}>
                    <span className="sh-item-label">{sessionLabel(r.sessionId)}</span>
                    <span className="sh-item-meta sh-hits">{r.hits.length} 处命中</span>
                    <div className="sh-snippets">
                      {r.hits.slice(0, 2).map((h, i) => (
                        <p key={i} className="sh-snippet" title={h.snippet}>{h.snippet}</p>
                      ))}
                    </div>
                  </div>
                ))
              )
            ) : (
              <>
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
              </>
            )}
          </div>
          <div className="sh-detail">
            {activeFile && (
              <div className="sh-detail-actions">
                <button className="assistant-btn" onClick={() => void branchToNote()} disabled={branching} title="生成 vault 笔记；固定后作为新会话上下文（按笔记分支）">
                  <FileText size={12} />
                  {branching ? '生成中…' : '分支为笔记'}
                </button>
              </div>
            )}
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
