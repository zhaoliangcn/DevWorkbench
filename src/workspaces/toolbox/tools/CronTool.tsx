import { useEffect, useMemo, useState } from 'react'
import { parseCron, nextRun, replaceField, type CronRule } from '../utils/cron'
import { electronAPI, type CronTaskDef, type CronLogEntryDef } from '../utils/electron'

const CRON_STORE_KEY = 'cron'

const FIELD_DEFS = [
  { label: '分', index: 0, min: 0, max: 59 },
  { label: '时', index: 1, min: 0, max: 23 },
  { label: '日', index: 2, min: 1, max: 31 },
  { label: '月', index: 3, min: 1, max: 12 },
  { label: '周', index: 4, min: 0, max: 6 },
] as const

const DOW_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const PRESETS = [
  { label: '每 15 分钟', expr: '*/15 * * * *' },
  { label: '工作日 09:00', expr: '0 9 * * 1-5' },
  { label: '每天 00:00', expr: '0 0 * * *' },
  { label: '每晚 21:30', expr: '30 21 * * *' },
  { label: '每月 1 号 12:00', expr: '0 12 1 * *' },
  { label: '每周日 08:00', expr: '0 8 * * 0' },
]

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

interface SavedRequest {
  key: string
  label: string
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} 周${'日一二三四五六'[d.getDay()]}`
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function targetSummary(t: CronTaskDef['target']): string {
  if (t.type === 'http') return `${t.method ?? 'GET'} ${t.url}`
  if (t.type === 'agent') return `Agent：${t.prompt}`
  return t.command
}

/** 附录 F：Cron 可视化（F.4a 解析/滑块/预览 + F.4b HTTP/脚本触发 + F.4c Agent 任务触发） */
export function CronTool() {
  const [expr, setExpr] = useState('*/15 * * * *')
  const [tasks, setTasks] = useState<CronTaskDef[]>([])
  const [logs, setLogs] = useState<CronLogEntryDef[]>([])
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([])
  const [formError, setFormError] = useState('')

  // 新建任务表单
  const [name, setName] = useState('')
  const [taskExpr, setTaskExpr] = useState('*/15 * * * *')
  const [targetType, setTargetType] = useState<'http' | 'script' | 'agent'>('http')
  const [savedKey, setSavedKey] = useState('')
  const [url, setUrl] = useState('')
  const [method, setMethod] = useState('GET')
  const [body, setBody] = useState('')
  const [command, setCommand] = useState('')
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    void electronAPI.loadData(CRON_STORE_KEY).then((d) => {
      const saved = (d as { expr?: string } | null)?.expr
      if (typeof saved === 'string' && saved.trim()) setExpr(saved)
    })
    void electronAPI.cronGetTasks().then((s) => {
      setTasks(s.tasks)
      setLogs(s.logs)
    })
    // F.4b：HTTP 目标可选已保存请求（HttpModule 集合快照）
    void electronAPI.loadData('api').then((d) => {
      const data = d as { collections?: { id: string; name: string; requests?: { id: string; name: string; method: string; url: string; headers?: Record<string, string>; body?: string }[] }[] } | null
      const list: SavedRequest[] = []
      for (const c of data?.collections ?? []) {
        for (const r of c.requests ?? []) {
          if (r.url) list.push({ key: `${c.id}/${r.id}`, label: `${c.name} / ${r.name || r.url}`, method: r.method, url: r.url, headers: r.headers, body: r.body })
        }
      }
      setSavedRequests(list)
    })
    const off = electronAPI.onCronLog((entry) => {
      setLogs((prev) => [...prev, entry].slice(-200))
    })
    return off
  }, [])

  const updateExpr = (next: string) => {
    setExpr(next)
    void electronAPI.saveData(CRON_STORE_KEY, { expr: next })
  }

  const parsed = useMemo<{ rule?: CronRule; error?: string }>(() => {
    try {
      return { rule: parseCron(expr) }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [expr])

  const runs = useMemo(() => {
    if (!parsed.rule) return []
    return nextRun(parsed.rule, new Date(), 10)
  }, [parsed])

  const fieldParts = expr.trim().split(/\s+/)
  const ruleValues = parsed.rule
    ? [parsed.rule.minutes, parsed.rule.hours, parsed.rule.daysOfMonth, parsed.rule.months, parsed.rule.daysOfWeek]
    : null

  const sliderValue = (i: number, min: number): number => {
    const vals = ruleValues?.[i]
    return vals && vals.length > 0 ? vals[0] : min
  }

  const fieldText = (i: number): string => {
    const part = fieldParts[i]
    if (!part) return ''
    if (i === 4 && /^\d$/.test(part)) return DOW_LABELS[Number(part) % 7]
    return part
  }

  const persistTasks = async (next: CronTaskDef[]) => {
    setTasks(next)
    const r = await electronAPI.cronSetTasks(next)
    if (!r.success && r.error) setFormError(r.error)
  }

  const addTask = () => {
    setFormError('')
    if (!name.trim()) return setFormError('请填写任务名称')
    try {
      parseCron(taskExpr)
    } catch (e) {
      return setFormError((e as Error).message)
    }
    let target: CronTaskDef['target']
    if (targetType === 'http') {
      if (!/^https?:\/\//i.test(url.trim())) return setFormError('HTTP 目标需以 http(s):// 开头')
      target = { type: 'http', url: url.trim(), method, body: body || undefined }
    } else if (targetType === 'script') {
      if (!command.trim()) return setFormError('请填写本地脚本命令')
      target = { type: 'script', command: command.trim() }
    } else {
      if (!prompt.trim()) return setFormError('请填写 Agent 任务提示词')
      target = { type: 'agent', prompt: prompt.trim() }
    }
    const task: CronTaskDef = { id: genId(), name: name.trim(), expr: taskExpr.trim(), target, enabled: true }
    void persistTasks([...tasks, task])
    setName('')
    setUrl('')
    setBody('')
    setCommand('')
    setPrompt('')
    setSavedKey('')
  }

  const toggleTask = (t: CronTaskDef) => {
    void persistTasks(tasks.map((x) => (x.id === t.id ? { ...x, enabled: !x.enabled } : x)))
  }

  const removeTask = (t: CronTaskDef) => {
    void persistTasks(tasks.filter((x) => x.id !== t.id))
  }

  const triggerTask = async (t: CronTaskDef) => {
    setFormError('')
    if (t.target.type === 'script' && !window.confirm(`执行本地脚本？\n\n${t.target.command}`)) return
    if (t.target.type === 'agent' && !window.confirm(`执行 Agent 任务？\n\n${t.target.prompt}`)) return
    const r = await electronAPI.cronTrigger(t.id)
    if (!r.success && r.error) setFormError(r.error)
  }

  const clearLogs = async () => {
    await electronAPI.cronClearLogs()
    setLogs([])
  }

  const selectSaved = (key: string) => {
    setSavedKey(key)
    const s = savedRequests.find((r) => r.key === key)
    if (s) {
      setUrl(s.url)
      setMethod(s.method)
      setBody(s.body ?? '')
    }
  }

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>Cron 可视化</h3>
      </div>
      <div className="module-body">
        <div className="section-title">表达式</div>
        <div className="url-bar">
          <input
            value={expr}
            onChange={(e) => updateExpr(e.target.value)}
            placeholder="分 时 日 月 周，如 */15 * * * *"
            spellCheck={false}
          />
        </div>
        {parsed.error && <p className="cron-error">{parsed.error}</p>}

        <div className="cron-presets">
          {PRESETS.map((p) => (
            <button key={p.expr} className="btn-secondary cron-preset" onClick={() => updateExpr(p.expr)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="section-title">字段滑块</div>
        <div className="cron-sliders">
          {FIELD_DEFS.map((f) => (
            <div key={f.label} className="cron-slider-row">
              <span className="cron-slider-label">{f.label}</span>
              <input
                type="range"
                min={f.min}
                max={f.max}
                value={sliderValue(f.index, f.min)}
                disabled={!parsed.rule}
                onChange={(e) => updateExpr(replaceField(expr, f.index, Number(e.target.value)))}
              />
              <span className="cron-field-text">{fieldText(f.index)}</span>
            </div>
          ))}
        </div>

        <div className="section-title">接下来 10 次触发</div>
        {parsed.rule ? (
          <div className="cron-preview-list">
            {runs.map((d, i) => (
              <div key={`${d.getTime()}-${i}`} className={`history-item cron-preview-item${i === 0 ? ' first' : ''}`}>
                <span className="cron-preview-index">{i + 1}</span>
                <span className="cron-preview-time">{fmtDate(d)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-empty-text">表达式非法，修正后显示触发预览。</p>
        )}

        <div className="section-title">触发任务</div>
        {tasks.length === 0 && <p className="panel-empty-text">暂无任务。下方新建一个，按表达式自动触发 HTTP 请求或本地脚本。</p>}
        <div className="cron-task-list">
          {tasks.map((t) => (
            <div key={t.id} className="history-item cron-task-item">
              <div className="cron-task-head">
                <input type="checkbox" checked={t.enabled} onChange={() => toggleTask(t)} title="启用/停用" />
                <span className="cron-task-name">{t.name}</span>
                <span className="cron-target-tag">{t.target.type === 'http' ? 'HTTP' : t.target.type === 'agent' ? 'Agent' : '脚本'}</span>
                <span className="cron-task-expr">{t.expr}</span>
                <button className="btn-secondary" onClick={() => void triggerTask(t)}>立即触发</button>
                <button className="btn-secondary btn-danger-icon" onClick={() => removeTask(t)}>删除</button>
              </div>
              <div className="cron-task-meta">
                {targetSummary(t.target)}
                {t.lastRunAt ? ` · 上次触发 ${fmtTime(t.lastRunAt)}` : ' · 尚未触发'}
              </div>
            </div>
          ))}
        </div>

        <div className="cron-add-form">
          <div className="cron-add-row">
            <input className="cron-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="任务名称" />
            <input className="cron-expr-input" value={taskExpr} onChange={(e) => setTaskExpr(e.target.value)} placeholder="*/15 * * * *" spellCheck={false} />
            <select value={targetType} onChange={(e) => setTargetType(e.target.value as 'http' | 'script' | 'agent')}>
              <option value="http">HTTP 请求</option>
              <option value="script">本地脚本</option>
              <option value="agent">Agent 任务</option>
            </select>
            <button className="btn-secondary" onClick={addTask}>新建任务</button>
          </div>
          {targetType === 'http' ? (
            <>
              <div className="cron-add-row">
                <select value={savedKey} onChange={(e) => selectSaved(e.target.value)}>
                  <option value="">{savedRequests.length > 0 ? '从已保存请求导入…' : '（无已保存请求，手动填写）'}</option>
                  {savedRequests.map((r) => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {HTTP_METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="cron-add-row">
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" spellCheck={false} />
              </div>
              <div className="cron-add-row">
                <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="请求 Body（可选，POST/PUT/PATCH 时发送）" spellCheck={false} />
              </div>
            </>
          ) : targetType === 'script' ? (
            <div className="cron-add-row">
              <textarea
                className="cron-command-input"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                rows={2}
                placeholder="shell 命令，如：/usr/local/bin/backup.sh（执行需确认，30s 超时）"
                spellCheck={false}
              />
            </div>
          ) : (
            <div className="cron-add-row">
              <textarea
                className="cron-command-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                placeholder="Agent 提示词，如：检查今日待办并生成摘要（需 AI 助手页已启动；到点自动执行，手动触发需确认）"
              />
            </div>
          )}
          {formError && <p className="cron-error">{formError}</p>}
        </div>

        <div className="section-title">
          触发日志
          {logs.length > 0 && (
            <button className="btn-secondary cron-clear-logs" onClick={() => void clearLogs()}>清空日志</button>
          )}
        </div>
        {logs.length === 0 ? (
          <p className="panel-empty-text">暂无触发记录。</p>
        ) : (
          <div className="cron-preview-list">
            {logs
              .slice()
              .reverse()
              .map((l) => (
                <div key={l.id} className="history-item cron-log-item">
                  <span className={`assert-chip ${l.ok ? 'pass' : 'fail'}`}>{l.ok ? '成功' : '失败'}</span>
                  <span className="cron-target-tag">{l.target === 'http' ? 'HTTP' : l.target === 'agent' ? 'Agent' : '脚本'}</span>
                  <span className="cron-task-name">{l.taskName}</span>
                  <span className="cron-log-detail" title={l.detail}>{l.detail}</span>
                  <span className="cron-log-time">{fmtTime(l.at)}</span>
                </div>
              ))}
          </div>
        )}

        <p className="panel-empty-text cron-note">三种触发目标齐备（HTTP / 本地脚本 / Agent）；日志与「定时任务看板」（B.3）同源（agent-task-log）。</p>
      </div>
    </div>
  )
}
