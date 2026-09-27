import { useEffect, useState } from 'react'
import { CalendarClock, RefreshCw, X, RotateCcw, Play } from 'lucide-react'
import { electronAPI, type CronTaskDef, type CronLogEntryDef } from '../toolbox/utils/electron'
import { parseCron } from '../toolbox/utils/cron'

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

interface TaskBoardProps {
  onClose: () => void
}

/**
 * 附录 B.3：定时任务看板（AI 助手工作区内）
 * 聚焦 Agent 类型定时任务：查看/创建/暂停/删除 + 运行日志 + 失败重试。
 * 数据源与 F.4 Cron 工具同源（cron:tasks / agent-task-log），cronSetTasks 为全量替换 ——
 * 本组件持有全量任务列表，渲染时过滤 agent 目标。
 */
export function TaskBoard({ onClose }: TaskBoardProps) {
  const [tasks, setTasks] = useState<CronTaskDef[]>([])
  const [logs, setLogs] = useState<CronLogEntryDef[]>([])
  const [name, setName] = useState('')
  const [expr, setExpr] = useState('0 9 * * 1-5')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [runningId, setRunningId] = useState('')

  const agentTasks = tasks.filter((t) => t.target.type === 'agent')
  const agentLogs = logs.filter((l) => l.target === 'agent')

  useEffect(() => {
    void electronAPI.cronGetTasks().then((s) => {
      setTasks(s.tasks)
      setLogs(s.logs)
    })
    return electronAPI.onCronLog((entry) => {
      if (entry.target === 'agent') {
        setLogs((prev) => [...prev, entry].slice(-200))
      }
    })
  }, [])

  const reload = async () => {
    const s = await electronAPI.cronGetTasks()
    setTasks(s.tasks)
    setLogs(s.logs)
  }

  const persist = async (next: CronTaskDef[]) => {
    setError('')
    const r = await electronAPI.cronSetTasks(next)
    if (!r.success && r.error) return setError(r.error)
    setTasks(next)
  }

  const create = () => {
    setError('')
    if (!name.trim()) return setError('请填写任务名称')
    try {
      parseCron(expr)
    } catch (e) {
      return setError((e as Error).message)
    }
    if (!prompt.trim()) return setError('请填写 Agent 提示词')
    const task: CronTaskDef = {
      id: genId(),
      name: name.trim(),
      expr: expr.trim(),
      target: { type: 'agent', prompt: prompt.trim() },
      enabled: true,
    }
    void persist([...tasks, task])
    setName('')
    setPrompt('')
  }

  const toggle = (t: CronTaskDef) => {
    void persist(tasks.map((x) => (x.id === t.id ? { ...x, enabled: !x.enabled } : x)))
  }

  const remove = (t: CronTaskDef) => {
    void persist(tasks.filter((x) => x.id !== t.id))
  }

  const run = async (t: CronTaskDef) => {
    setError('')
    if (t.target.type !== 'agent') return
    if (!window.confirm(`执行 Agent 任务？\n\n${t.target.prompt}`)) return
    setRunningId(t.id)
    const r = await electronAPI.cronTrigger(t.id)
    setRunningId('')
    if (!r.success && r.error) setError(r.error)
  }

  return (
    <div className="sh-overlay">
      <div className="sh-panel">
        <div className="sh-head">
          <CalendarClock size={14} />
          <span>定时任务看板</span>
          <div className="sh-head-actions">
            <button className="assistant-btn" onClick={() => void reload()} title="刷新">
              <RefreshCw size={12} />
            </button>
            <button className="assistant-btn" onClick={onClose} title="关闭">
              <X size={12} />
            </button>
          </div>
        </div>
        {error && <div className="assistant-banner-error">{error}</div>}
        <div className="sh-body tb-board">
          <div className="tb-section-title">新建 Agent 定时任务</div>
          <div className="tb-create">
            <div className="tb-create-row">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="任务名称，如：每日晨报" />
              <input className="tb-expr" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="0 9 * * 1-5" spellCheck={false} />
              <button className="assistant-btn tb-create-btn" onClick={create}>创建</button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="Agent 提示词，如：读取今日待办笔记并生成摘要，保存到「日报」文件夹（需助手已启动）"
            />
          </div>

          <div className="tb-section-title">任务（{agentTasks.length}）</div>
          {agentTasks.length === 0 ? (
            <p className="panel-empty-text">暂无 Agent 定时任务。HTTP/脚本目标请在工具箱「Cron 可视化」中管理。</p>
          ) : (
            <div className="tb-task-list">
              {agentTasks.map((t) => (
                <div key={t.id} className="tb-task">
                  <label className="tb-task-toggle" title="启用/暂停">
                    <input type="checkbox" checked={t.enabled} onChange={() => toggle(t)} />
                    <span>{t.enabled ? '运行中' : '已暂停'}</span>
                  </label>
                  <div className="tb-task-main">
                    <div className="tb-task-name">{t.name}</div>
                    <div className="tb-task-meta">
                      {t.expr} · 上次{t.lastRunAt ? ` ${fmtTime(t.lastRunAt)}` : '未触发'}
                    </div>
                  </div>
                  <div className="tb-task-actions">
                    <button className="assistant-btn" title="立即运行" onClick={() => void run(t)} disabled={runningId === t.id}>
                      {runningId === t.id ? '…' : <Play size={12} />}
                    </button>
                    <button className="assistant-btn" title="删除" onClick={() => remove(t)}>
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="tb-section-title">运行日志（{agentLogs.length}）</div>
          {agentLogs.length === 0 ? (
            <p className="panel-empty-text">暂无运行记录。</p>
          ) : (
            <div className="tb-log-list">
              {agentLogs
                .slice()
                .reverse()
                .map((l) => {
                  const task = tasks.find((t) => t.id === l.taskId)
                  return (
                    <div key={l.id} className="tb-log">
                      <span className={`tb-chip ${l.ok ? 'ok' : 'fail'}`}>{l.ok ? '成功' : '失败'}</span>
                      <span className="tb-log-name">{l.taskName}</span>
                      <span className="tb-log-detail" title={l.detail}>{l.detail}</span>
                      <span className="tb-log-time">{fmtTime(l.at)}</span>
                      {!l.ok && task && (
                        <button className="assistant-btn" title="失败重试" onClick={() => void run(task)}>
                          <RotateCcw size={12} />
                        </button>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
