import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Square, Loader2, Wrench, Check, X } from 'lucide-react'
import { useAssistantStore } from '../../store/assistantStore'
import { assistantAPI } from './utils/electron'
import './assistant.css'

/**
 * AI 助手工作区（Phase 6）：嵌入 dev-assistant-ts 的 Agent 聊天 UI。
 *
 * - 启动时经 IPC 用当前模型配置启动助手（workingDir 固定为知识库 Vault）
 * - assistant:events 事件流式渲染（文本增量 / 工具调用 / 状态 / 错误）
 * - 消息发送 → assistant:run（主进程驱动完整 Agent 循环）
 */

export function AssistantWorkspace() {
  const models = useAssistantStore((s) => s.models)
  const activeModel = useAssistantStore((s) => s.activeModel)
  const status = useAssistantStore((s) => s.status)
  const setStatus = useAssistantStore((s) => s.setStatus)
  const running = useAssistantStore((s) => s.running)
  const setRunning = useAssistantStore((s) => s.setRunning)
  const error = useAssistantStore((s) => s.error)
  const setError = useAssistantStore((s) => s.setError)
  const messages = useAssistantStore((s) => s.messages)
  const pushMessage = useAssistantStore((s) => s.pushMessage)
  const appendToLast = useAssistantStore((s) => s.appendToLast)
  const clearMessages = useAssistantStore((s) => s.clearMessages)

  const [input, setInput] = useState('')
  const startedRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)

  // 首次进入工作区：刷新状态并按需启动
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void (async () => {
      try {
        const st = await assistantAPI.status()
        setStatus(st)
        const active = models.find((m) => m.name === activeModel) ?? models[0]
        if (!st.running && active && active.apiKey.length > 0 || active.provider === 'ollama') {
          const res = await assistantAPI.start({
            models,
            schedulerEnabled: true,
            approvalEnabled: false,
          })
          setStatus(res.status)
          setError(res.error ?? '')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 事件订阅（assistant:events 广播）
  useEffect(() => {
    const off = assistantAPI.onEvent((raw) => {
      const e = raw as {
        kind?: string
        content?: string
        call?: { function?: { name?: string; arguments?: string } }
        name?: string
        success?: boolean
        result?: { success?: boolean; content?: string }
      }
      switch (e.kind) {
        case 'assistantStreamDelta':
          appendToLast(e.content ?? '')
          break
        case 'toolCall':
          pushMessage({
            role: 'tool',
            toolName: e.call?.function?.name,
            content: e.call?.function?.arguments ?? '',
          })
          break
        case 'toolResult':
          pushMessage({
            role: e.result?.success ? 'status' : 'error',
            content: `[${e.name ?? 'tool'}] ${(e.result?.content ?? '').slice(0, 300)}`,
          })
          break
        case 'status':
          pushMessage({ role: 'status', content: e.content ?? '' })
          break
        case 'reasoningDelta':
          // 思考流不展开，忽略（避免噪声）
          break
        default:
          break
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动滚动
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || running) return
    setInput('')
    pushMessage({ role: 'user', content: text })
    setRunning(true)
    setError('')
    try {
      const res = await assistantAPI.run(text)
      if (res.error) {
        pushMessage({ role: 'error', content: res.error })
      } else if (!res.message) {
        // 工具循环完成但无文本收尾：补一个状态行
        pushMessage({ role: 'status', content: '（运行完成，无文本回复）' })
      }
    } catch (e) {
      pushMessage({ role: 'error', content: e instanceof Error ? e.message : String(e) })
    } finally {
      setRunning(false)
    }
  }

  const assistantRunning = status?.running ?? false

  return (
    <div className="assistant-workspace">
      <div className="assistant-header">
        <div className="assistant-header-left">
          <Bot size={18} className={assistantRunning ? 'assistant-dot-on' : ''} />
          <span className="assistant-title">AI 助手</span>
          <span className={`assistant-badge ${assistantRunning ? 'on' : ''}`}>
            {assistantRunning ? `运行中 · ${status?.activeProvider ?? '-'}` : '未启动'}
          </span>
        </div>
        <div className="assistant-header-right">
          {models.length > 0 && (
            <select
              value={activeModel}
              onChange={(e) => useAssistantStore.getState().setActiveModel(e.target.value)}
              disabled={running}
              title="活跃模型"
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <button className="assistant-btn" onClick={clearMessages} disabled={running || messages.length === 0}>
            清空
          </button>
        </div>
      </div>

      {error && <div className="assistant-banner-error">{error}</div>}

      <div className="assistant-log" ref={logRef}>
        {messages.length === 0 && (
          <div className="assistant-empty">
            <Bot size={40} />
            <p>向知识库中的笔记提问，或让助手帮你读写文件。</p>
            <p className="assistant-empty-hint">
              助手以知识库 Vault 为工作目录，具备文件读写、Glob/Grep、技能与定时任务能力。
            </p>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="assistant-msg user">
                <span className="assistant-msg-role">你</span>
                <div className="assistant-msg-content">{m.content}</div>
              </div>
            )
          }
          if (m.role === 'assistant') {
            return (
              <div key={m.id} className="assistant-msg assistant">
                <span className="assistant-msg-role">
                  <Bot size={13} /> 助手
                </span>
                <div className="assistant-msg-content markdown-body">
                  {m.content}
                  {running && <span className="assistant-caret" />}
                </div>
              </div>
            )
          }
          if (m.role === 'tool') {
            return (
              <div key={m.id} className="assistant-msg tool">
                <span className="assistant-msg-role">
                  <Wrench size={13} /> {m.toolName ?? 'tool'}
                </span>
                <pre className="assistant-tool-args">{m.content}</pre>
              </div>
            )
          }
          if (m.role === 'error') {
            return (
              <div key={m.id} className="assistant-msg error">
                <span className="assistant-msg-role">
                  <X size={13} /> 错误
                </span>
                <div className="assistant-msg-content">{m.content}</div>
              </div>
            )
          }
          return (
            <div key={m.id} className="assistant-msg status-line">
              <Check size={13} /> {m.content}
            </div>
          )
        })}
        {running && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="assistant-msg status-line">
            <Loader2 size={13} className="spin" /> 执行中…
          </div>
        )}
      </div>

      <div className="assistant-input-row">
        <input
          className="assistant-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
          placeholder="输入消息…（Enter 发送）"
          disabled={running}
        />
        {running ? (
          <button className="assistant-send" disabled title="运行中">
            <Loader2 size={15} className="spin" />
          </button>
        ) : (
          <button className="assistant-send" onClick={handleSend} disabled={!input.trim()}>
            <Send size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

// Square 图标预留（取消按钮占位：Agent cancel 在工具边界生效）
void Square
