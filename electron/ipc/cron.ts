// 附录 F F.4b：Cron 触发调度器 —— 主进程定时器轮询（15s 对齐分钟），
// 命中即触发 HTTP 请求（复用 http:request handler）或本地脚本（exec，30s 超时）。
// 任务持久化 data 键 'cron-tasks'；触发日志写 'agent-task-log'（与 B.3 定时任务看板同源），
// 并经 'cron:log' 实时推送 renderer。Agent 任务触发留待 F.4c。
import { ipcMain, BrowserWindow, dialog } from 'electron'
import { exec } from 'node:child_process'
import crypto from 'node:crypto'
import { parseCron, ruleMatches, type CronRule } from './cron-core.js'
import { loadDataFile, saveDataFile } from './data.js'
import { ringPush } from './webhook.js'
import { httpRequestHandler } from './http.js'
import { runAgentTask } from './assistant.js'

export interface CronTargetHttp {
  type: 'http'
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface CronTargetScript {
  type: 'script'
  command: string
}

export interface CronTargetAgent {
  type: 'agent'
  prompt: string
}

export type CronTarget = CronTargetHttp | CronTargetScript | CronTargetAgent

export interface CronTask {
  id: string
  name: string
  expr: string
  target: CronTarget
  enabled: boolean
  lastRunAt?: number
}

export interface CronLogEntry {
  id: string
  taskId: string
  taskName: string
  target: string
  ok: boolean
  detail: string
  at: number
}

const CRON_LOG_MAX = 200
const SCRIPT_TIMEOUT_MS = 30_000
const HTTP_TIMEOUT_MS = 30_000
const TICK_MS = 15_000
const TASKS_KEY = 'cron-tasks'
const LOG_KEY = 'agent-task-log'

/* ---------- 可测纯逻辑 ---------- */

/** 校验任务清单：表达式可解析、目标字段完备；返回首个错误或 null */
export function validateTasks(tasks: CronTask[]): string | null {
  for (const t of tasks) {
    if (!t.name?.trim()) return '任务名称不能为空'
    try {
      parseCron(t.expr)
    } catch (e) {
      return `任务「${t.name}」：${(e as Error).message}`
    }
    if (t.target.type === 'http') {
      if (!/^https?:\/\//i.test(t.target.url)) return `任务「${t.name}」：HTTP 目标需以 http(s):// 开头`
    } else if (t.target.type === 'script') {
      if (!t.target.command?.trim()) return `任务「${t.name}」：脚本命令不能为空`
      if (t.target.command.length > 2000) return `任务「${t.name}」：脚本命令过长（≤2000 字符）`
    } else if (!t.target.prompt?.trim()) {
      return `任务「${t.name}」：Agent 任务提示词不能为空`
    }
  }
  return null
}

function truncate(s: string, max = 400): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/* ---------- 脚本命令首次执行确认（哈希钉定） ----------
 * 脚本目标是渲染端可控的 shell 执行原语：命令首次执行前弹系统级确认对话框，
 * 批准按命令 sha256 记账（持久化），同一命令此后不再询问；命令内容变更即重新确认。 */

const APPROVED_SCRIPTS_KEY = 'cron-approved-scripts'
let approvedScriptHashes: Set<string> | null = null

function loadApprovedScriptHashes(): Set<string> {
  if (!approvedScriptHashes) {
    try {
      approvedScriptHashes = new Set(loadDataFile<string[]>(APPROVED_SCRIPTS_KEY) ?? [])
    } catch {
      // 存储读取失败按空集处理：退化为逐次确认，不影响调度器运行
      approvedScriptHashes = new Set()
    }
  }
  return approvedScriptHashes
}

function scriptCommandHash(command: string): string {
  return crypto.createHash('sha256').update(command, 'utf8').digest('hex')
}

async function confirmScriptCommand(command: string): Promise<boolean> {
  const approved = loadApprovedScriptHashes()
  const hash = scriptCommandHash(command)
  if (approved.has(hash)) return true
  const win = BrowserWindow.getAllWindows()[0]
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Cron 脚本首次执行确认',
    message: '以下脚本命令尚未批准执行，是否允许？',
    detail: `${command.slice(0, 1000)}${command.length > 1000 ? '\n…' : ''}\n\n「始终允许」后同一命令（内容一致）不再询问；修改命令会重新确认。`,
    buttons: ['取消', '仅此一次允许', '始终允许此命令'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  if (response === 0) return false
  if (response === 2) {
    approved.add(hash)
    saveDataFile(APPROVED_SCRIPTS_KEY, [...approved])
  }
  return true
}

/** 执行一次触发目标（http 走主进程 fetch；script 走 shell exec） */
export async function fireTarget(target: CronTarget): Promise<{ ok: boolean; detail: string }> {
  if (target.type === 'http') {
    const r = await httpRequestHandler({
      url: target.url,
      method: target.method,
      headers: target.headers,
      body: target.body,
      timeoutMs: HTTP_TIMEOUT_MS,
    })
    return r.success
      ? { ok: true, detail: `HTTP ${r.status} ${r.statusText}（${r.durationMs}ms）` }
      : { ok: false, detail: truncate(r.error ?? 'HTTP 请求失败') }
  }
  if (target.type === 'agent') {
    const r = await runAgentTask(target.prompt)
    return { ok: r.ok, detail: truncate(r.detail) }
  }
  if (typeof target.command !== 'string' || !(await confirmScriptCommand(target.command))) {
    return { ok: false, detail: '脚本命令未获确认，已跳过执行' }
  }
  return new Promise((resolve) => {
    exec(
      target.command,
      { timeout: SCRIPT_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const reason = stderr?.trim() || err.message
          resolve({ ok: false, detail: truncate(`exit=${err.code ?? '?'} ${reason}`) })
          return
        }
        const out = [stdout?.trim(), stderr?.trim()].filter(Boolean).join(' | ')
        resolve({ ok: true, detail: truncate(out || '(无输出)') })
      },
    )
  })
}

function minuteKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`
}

/* ---------- 模块级单例状态 ---------- */

let tasks: CronTask[] = []
let logs: CronLogEntry[] = []
const rules = new Map<string, CronRule>()
const lastFired = new Map<string, string>()
let timer: NodeJS.Timeout | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function rebuildRules(): void {
  rules.clear()
  for (const t of tasks) {
    try {
      rules.set(t.id, parseCron(t.expr))
    } catch (e) {
      console.warn(`[cron] 任务「${t.name}」表达式非法，已跳过：${(e as Error).message}`)
    }
  }
}

function appendLog(entry: CronLogEntry): void {
  logs = ringPush(logs, entry, CRON_LOG_MAX)
  saveDataFile(LOG_KEY, logs)
  broadcast('cron:log', entry)
}

async function runTask(task: CronTask): Promise<CronLogEntry> {
  const entry: CronLogEntry = {
    id: genId(),
    taskId: task.id,
    taskName: task.name,
    target: task.target.type,
    ok: false,
    detail: '',
    at: Date.now(),
  }
  try {
    const r = await fireTarget(task.target)
    entry.ok = r.ok
    entry.detail = r.detail
  } catch (e) {
    entry.detail = truncate((e as Error).message)
  }
  return entry
}

function checkAndFire(now = new Date()): void {
  const key = minuteKey(now)
  for (const t of tasks) {
    if (!t.enabled) continue
    const rule = rules.get(t.id)
    if (!rule || !ruleMatches(rule, now)) continue
    if (lastFired.get(t.id) === key) continue
    lastFired.set(t.id, key)
    t.lastRunAt = now.getTime()
    void runTask(t).then(appendLog)
  }
}

function ensureTimer(): void {
  if (timer) return
  timer = setInterval(() => {
    try {
      checkAndFire()
    } catch (e) {
      console.error('[cron] 调度轮询异常：', e)
    }
  }, TICK_MS)
  timer.unref?.() // 不阻止应用退出
}

function persistTasks(): void {
  saveDataFile(TASKS_KEY, tasks)
}

/* ---------- IPC ---------- */

function registerCronIpc() {
  tasks = loadDataFile<CronTask[]>(TASKS_KEY) ?? []
  logs = loadDataFile<CronLogEntry[]>(LOG_KEY) ?? []
  rebuildRules()
  ensureTimer()

  ipcMain.handle('cron:tasks:get', () => ({ tasks, logs }))

  ipcMain.handle('cron:tasks:set', (_event, next: CronTask[]) => {
    const err = validateTasks(next ?? [])
    if (err) return { success: false, error: err, tasks, logs }
    tasks = (next ?? []).map((t) => ({ ...t }))
    rebuildRules()
    const ids = new Set(tasks.map((t) => t.id))
    for (const id of [...lastFired.keys()]) {
      if (!ids.has(id)) lastFired.delete(id)
    }
    persistTasks()
    ensureTimer()
    return { success: true, tasks, logs }
  })

  ipcMain.handle('cron:trigger', async (_event, id: string) => {
    const task = tasks.find((t) => t.id === id)
    if (!task) return { success: false, error: '任务不存在' }
    const entry = await runTask(task)
    task.lastRunAt = entry.at
    appendLog(entry)
    return { success: true, log: entry }
  })

  ipcMain.handle('cron:logs:clear', () => {
    logs = []
    saveDataFile(LOG_KEY, logs)
    return true
  })
}

function stopCronScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export { registerCronIpc, stopCronScheduler }
