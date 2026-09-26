import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Square, Loader2, Wrench, Check, X, Pin, ShieldAlert, ShieldCheck, History, Sparkles, Trash2, Pencil } from 'lucide-react'
import { useAssistantStore } from '../../store/assistantStore'
import { useCrossStore } from '../../store/crossStore'
import { useStore as useKnowledgeStore } from '../../store/knowledgeStore'
import { assistantAPI } from './utils/electron'
import { buildPinnedContext } from './context-inject'
import { SessionHistory } from './SessionHistory'
import './assistant.css'

/**
 * AI 助手工作区（Phase 6）：嵌入 dev-assistant-ts 的 Agent 聊天 UI。
 *
 * - 启动时经 IPC 用当前模型配置启动助手（workingDir 固定为知识库 Vault）
 * - assistant:events 事件流式渲染（文本增量 / 工具调用 / 状态 / 错误）
 * - 消息发送 → assistant:run（主进程驱动完整 Agent 循环）
 * - 切片 D：知识库钉选笔记作为上下文；审批墙（高危工具调用需手动批准）
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
  const approvalEnabled = useAssistantStore((s) => s.approvalEnabled)
  const setApprovalEnabled = useAssistantStore((s) => s.setApprovalEnabled)

  // 知识库钉选上下文（切片 D，设计 C.5）
  const pinnedIds = useKnowledgeStore((s) => s.pinnedForAssistant)
  const knowledgeNotes = useKnowledgeStore((s) => s.notes)
  const togglePinForAssistant = useKnowledgeStore((s) => s.togglePinForAssistant)
  const pinnedNotes = pinnedIds
    .map((id) => knowledgeNotes[id])
    .filter((n): n is NonNullable<typeof n> => Boolean(n))

  const [input, setInput] = useState('')
  const [pendingApproval, setPendingApproval] = useState<{
    id: string
    scope: string
    dangerLevel: string
  } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [skillName, setSkillName] = useState('')
  const [toolNames, setToolNames] = useState<string[]>([])
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  const skills = useAssistantStore((s) => s.skills)
  const activeSkill = useAssistantStore((s) => s.activeSkill)
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
            approvalEnabled: useAssistantStore.getState().approvalEnabled,
            policy: useAssistantStore.getState().policy,
          })
          setStatus(res.status)
          setError(res.error ?? '')
          // 技能模式在助手重启后重放工具过滤器（H.2）
          const act = useAssistantStore.getState().activeSkill
          if (!res.error && act?.tools) void assistantAPI.setToolFilter(act.tools)
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
        id?: string
        scope?: string
        requirement?: { dangerThreshold?: string; approvalType?: string }
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
        case 'approvalRequest':
          // 审批墙（切片 D）：主进程 ApprovalManager 触发，等待用户批准/拒绝
          setPendingApproval({
            id: e.id ?? '',
            scope: e.scope ?? '',
            dangerLevel: e.requirement?.dangerThreshold ?? '',
          })
          break
        case 'approvalTimeout':
          // 超时主进程已默认拒绝，这里只清 UI
          setPendingApproval((p) => (p && e.id && p.id !== e.id ? p : null))
          if (e.id) pushMessage({ role: 'status', content: '审批请求超时，已默认拒绝' })
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

  // 捕获中心「喂给助手」（切片 C）：carry 到达时填入输入框并清槽。
  // 外部事件驱动的状态同步，set-state-in-effect 在此为误报。
  const captureCarry = useCrossStore((s) => s.carry)
  const setCarry = useCrossStore((s) => s.setCarry)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (captureCarry?.source === 'capture') {
      setInput(captureCarry.content)
      setCarry(null)
    }
  }, [captureCarry, setCarry])
  /* eslint-enable react-hooks/set-state-in-effect */

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
    // 钉选上下文（设计 C.5 进阶版）：路径清单 + 预览，全文由 Agent 按需经工具读取
    // 拼装逻辑抽为纯函数（context-inject.ts），便于单测
    const full = buildPinnedContext(pinnedNotes, text)
    try {
      const res = await assistantAPI.run(full)
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

  /** 审批墙（切片 D）：批准/拒绝当前待审批的工具调用 */
  const handleApproval = async (approved: boolean) => {
    if (!pendingApproval) return
    const { id } = pendingApproval
    setPendingApproval(null)
    pushMessage({ role: 'status', content: approved ? '已批准本次工具调用' : '已拒绝本次工具调用' })
    try {
      await assistantAPI.approvalResponse(id, approved)
    } catch {
      // 主进程超时兜底，忽略回传失败
    }
  }

  /** 审批模式开关：运行中经 IPC 热切换（ApprovalManager.setDisabled），未启动则仅记录待启动生效 */
  const handleToggleApproval = async () => {
    const next = !approvalEnabled
    setApprovalEnabled(next)
    if (status?.running) {
      const r = await assistantAPI.setApprovalMode(next)
      if (!r.success) {
        setApprovalEnabled(!next)
        setError(r.error ?? '切换审批模式失败')
        return
      }
    }
    pushMessage({
      role: 'status',
      content: next ? '已开启审批墙：敏感工具调用需手动批准' : '已关闭审批墙：工具调用自动放行',
    })
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
          <button
            className={`assistant-btn ${approvalEnabled ? 'assistant-btn-on' : ''}`}
            onClick={handleToggleApproval}
            title={approvalEnabled ? '审批墙已开启：敏感工具调用需手动批准' : '审批墙已关闭：工具调用自动放行'}
          >
            {approvalEnabled ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
            审批
          </button>
          <button
            className="assistant-btn"
            onClick={() => {
              const next = !skillsOpen
              setSkillsOpen(next)
              // 展开时拉取当前可用工具清单（供绑定勾选）
              if (next)
                void assistantAPI.toolsList().then((r) => {
                  if (r.success) setToolNames(r.names)
                })
            }}
            title="技能预设：保存/应用常用 prompt"
          >
            <Sparkles size={13} />
            技能
          </button>
          <button className="assistant-btn" onClick={() => setHistoryOpen(true)} title="查看历史会话事件流">
            <History size={13} />
            历史
          </button>
          <button className="assistant-btn" onClick={clearMessages} disabled={running || messages.length === 0}>
            清空
          </button>
        </div>
      </div>

      {error && <div className="assistant-banner-error">{error}</div>}

      {activeSkill && (
        <div className="assistant-banner-skill">
          <Sparkles size={12} />
          <span>
            技能模式：{activeSkill.name}
            {activeSkill.tools ? `（限定 ${activeSkill.tools.length} 个工具）` : '（全部工具）'}
          </span>
          <button
            onClick={() => {
              useAssistantStore.getState().setActiveSkill(null)
              void assistantAPI.setToolFilter(null)
            }}
          >
            退出
          </button>
        </div>
      )}

      {skillsOpen && (
        <div className="assistant-skills-pop">
          {editingId ? (
            <div className="skills-edit-form">
              <input
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder="技能名称"
              />
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                rows={4}
                placeholder="prompt 模板"
              />
              {toolNames.length > 0 && (
                <div className="skills-tools">
                  <span className="skills-tools-label">绑定工具（不选 = 全部）</span>
                  <div className="skills-tools-list">
                    {toolNames.map((t) => (
                      <button
                        key={t}
                        className={`skills-tool-chip ${selectedTools.includes(t) ? 'on' : ''}`}
                        onClick={() =>
                          setSelectedTools((prev) =>
                            prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                          )
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="skills-edit-actions">
                <button
                  disabled={!editPrompt.trim()}
                  onClick={() => {
                    useAssistantStore.getState().updateSkill(editingId, {
                      ...(skillName.trim() ? { name: skillName.trim() } : {}),
                      prompt: editPrompt.trim(),
                      tools: selectedTools.length > 0 ? selectedTools : undefined,
                    })
                    setEditingId(null)
                    setSkillName('')
                    setEditPrompt('')
                    setSelectedTools([])
                  }}
                >
                  保存
                </button>
                <button
                  onClick={() => {
                    setEditingId(null)
                    setSkillName('')
                    setEditPrompt('')
                    setSelectedTools([])
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="skills-save-row">
                <input
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  placeholder="技能名称（可选，默认取输入前缀）"
                />
                <button
                  disabled={!input.trim()}
                  onClick={() => {
                    const prompt = input.trim()
                    useAssistantStore
                      .getState()
                      .addSkill(skillName.trim() || prompt.slice(0, 20), prompt, selectedTools)
                    setSkillName('')
                    setSelectedTools([])
                  }}
                >
                  存当前输入
                </button>
              </div>
              {toolNames.length > 0 && (
                <div className="skills-tools">
                  <span className="skills-tools-label">绑定工具（不选 = 全部）</span>
                  <div className="skills-tools-list">
                    {toolNames.map((t) => (
                      <button
                        key={t}
                        className={`skills-tool-chip ${selectedTools.includes(t) ? 'on' : ''}`}
                        onClick={() =>
                          setSelectedTools((prev) =>
                            prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                          )
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {skills.length === 0 && (
            <p className="skills-empty">暂无技能：先在输入框写好 prompt，再点「存当前输入」</p>
          )}
          {skills.map((s) => (
            <div
              key={s.id}
              className="skills-item"
              onClick={() => {
                // 应用技能（H.2）：填 prompt + 激活工具子集过滤
                setInput(s.prompt)
                setSkillsOpen(false)
                const tools = s.tools && s.tools.length > 0 ? s.tools : null
                useAssistantStore.getState().setActiveSkill(tools ? { name: s.name, tools } : null)
                if (tools) void assistantAPI.setToolFilter(tools)
              }}
              title="点击填入输入框并激活技能模式"
            >
              <span className="skills-name">{s.name}</span>
              <span className="skills-preview">{s.prompt.slice(0, 48)}</span>
              {s.tools && s.tools.length > 0 && (
                <span className="skills-badge" title={s.tools.join(', ')}>
                  {s.tools.length} 工具
                </span>
              )}
              <button
                className="skills-edit"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingId(s.id)
                  setSkillName(s.name)
                  setEditPrompt(s.prompt)
                  setSelectedTools(s.tools ?? [])
                }}
                title="编辑技能"
              >
                <Pencil size={11} />
              </button>
              <button
                className="skills-del"
                onClick={(e) => {
                  e.stopPropagation()
                  useAssistantStore.getState().removeSkill(s.id)
                }}
                title="删除技能"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingApproval && (
        <div className="assistant-approval">
          <ShieldAlert size={16} className="assistant-approval-icon" />
          <div className="assistant-approval-info">
            <strong>助手请求批准一次工具调用</strong>
            <span className="assistant-approval-scope" title={pendingApproval.scope}>
              {pendingApproval.scope || '（无作用域信息）'}
            </span>
            {pendingApproval.dangerLevel && (
              <span className="assistant-approval-meta">危险级别 ≥ {pendingApproval.dangerLevel}</span>
            )}
          </div>
          <button className="assistant-approval-btn approve" onClick={() => handleApproval(true)}>
            <Check size={13} /> 批准
          </button>
          <button className="assistant-approval-btn deny" onClick={() => handleApproval(false)}>
            <X size={13} /> 拒绝
          </button>
        </div>
      )}

      {pinnedNotes.length > 0 && (
        <div className="assistant-pinned-row">
          <Pin size={12} />
          <span className="assistant-pinned-label">上下文</span>
          {pinnedNotes.map((n) => (
            <span key={n.id} className="assistant-pin-chip" title={n.path}>
              {n.title}
              <button onClick={() => togglePinForAssistant(n.id)} title="取消钉选">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

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

      {historyOpen && <SessionHistory onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}

// Square 图标预留（取消按钮占位：Agent cancel 在工具边界生效）
void Square
