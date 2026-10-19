import { ipcMain, Notification, powerMonitor, BrowserWindow, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  advancePomodoro,
  createPomodoro,
  DEFAULT_DND_CONFIG,
  DEFAULT_POMODORO_CONFIG,
  dndEndTs,
  isInDnd,
  pausePomodoro,
  pomodoroTooltip,
  resolveNextFireAt,
  resumePomodoro,
  sanitizeDnd,
  sanitizePomodoroConfig,
  type DndConfig,
  type OneShot,
  type PomodoroConfig,
  type PomodoroState,
  type ScheduledAlarm,
} from '../alarm-core.js'
import {
  buildSpeakCommand,
  DEFAULT_ALERT_PREFS,
  sanitizeAlertPrefs,
  type AlertPrefs,
} from '../alarm-alerts.js'
import { initReminderCard, showReminderCard } from '../alarm-reminder.js'
import { initTray, rebuildTrayMenu, setTrayAlertFlash, updateTrayTooltip } from '../tray.js'

// 工具箱：闹钟提醒（alarm:* 命名空间）
// 定时调度留在主进程（渲染进程后台会被 Chromium 节流）：
// setTimeout 链指向最早到期事件，到期触发系统通知 + 任务栏闪烁，并广播
// alarm:changed 让渲染层刷新（渲染层拿绝对 endAt 本地每秒算倒计时显示）。
// - 番茄钟：工作/短休/长休自动轮转；运行态不持久化（重启回 idle）
// - 单次提醒/指定时刻闹钟/免打扰配置持久化到 userData/alarm-config.json
// - 免打扰期间通知静默入队（保留最近 20 条），时段结束后汇总补发；
//   跨零点时段（如 22:00–08:00）已支持
// - 唤醒（powerMonitor.resume）后立即补偿触发并重排
// - 托盘：图标常驻，tooltip 秒级倒计时，菜单快捷控制 + 开机自启
// - 增强提醒（可分别开关，alerts 配置持久化）：
//   语音播报（TTS）→ 右下角桌面提醒卡（滑入动画，可稍后 5 分钟）→ 托盘图标闪烁

const CONFIG_PATH = path.join(app.getPath('userData'), 'alarm-config.json')
const MAX_ONESHOTS = 20
const MAX_SCHEDULED = 20
const MAX_QUEUE = 20

interface PersistedConfig {
  pomodoroConfig: PomodoroConfig
  oneShots: OneShot[]
  scheduledAlarms: ScheduledAlarm[]
  dnd: DndConfig
  alerts: AlertPrefs
}

let pomodoroConfig: PomodoroConfig = { ...DEFAULT_POMODORO_CONFIG }
let pomodoro: PomodoroState | null = null // null = idle
let oneShots: OneShot[] = []
let scheduledAlarms: ScheduledAlarm[] = []
let dnd: DndConfig = { ...DEFAULT_DND_CONFIG }
let alerts: AlertPrefs = { ...DEFAULT_ALERT_PREFS }
let notifyQueue: { title: string; body: string; at: number }[] = []
let timer: NodeJS.Timeout | null = null
let tooltipTimer: NodeJS.Timeout | null = null
let speakProc: ChildProcess | null = null

const fmtHm = (hh: number, mm: number) => `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
const fmtHmAt = (ts: number) => {
  const d = new Date(ts)
  return fmtHm(d.getHours(), d.getMinutes())
}

function loadPersisted(now: number): PersistedConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Partial<PersistedConfig>
    return {
      pomodoroConfig: sanitizePomodoroConfig(raw.pomodoroConfig),
      oneShots: Array.isArray(raw.oneShots)
        ? raw.oneShots
            .filter((t): t is OneShot => !!t && typeof t.endAt === 'number' && typeof t.id === 'string')
            .slice(0, MAX_ONESHOTS)
        : [],
      scheduledAlarms: Array.isArray(raw.scheduledAlarms)
        ? raw.scheduledAlarms
            .filter((a): a is ScheduledAlarm => !!a && typeof a.id === 'string' && typeof a.nextFireAt === 'number')
            .slice(0, MAX_SCHEDULED)
            .map((a) => {
              const hh = Math.min(23, Math.max(0, Math.round(Number(a.hh)) || 0))
              const mm = Math.min(59, Math.max(0, Math.round(Number(a.mm)) || 0))
              const alarm: ScheduledAlarm = {
                id: a.id,
                hh,
                mm,
                label: String(a.label ?? '').slice(0, 200),
                repeatDaily: !!a.repeatDaily,
                enabled: !!a.enabled,
                nextFireAt: a.nextFireAt,
              }
              // 停机期间错过的闹钟：每日重复的重排到下一次；一次性静默停用
              if (alarm.enabled && alarm.nextFireAt <= now) {
                if (alarm.repeatDaily) alarm.nextFireAt = resolveNextFireAt(hh, mm, now)
                else alarm.enabled = false
              }
              return alarm
            })
        : [],
      dnd: sanitizeDnd(raw.dnd),
      alerts: sanitizeAlertPrefs(raw.alerts),
    }
  } catch {
    return {
      pomodoroConfig: { ...DEFAULT_POMODORO_CONFIG },
      oneShots: [],
      scheduledAlarms: [],
      dnd: { ...DEFAULT_DND_CONFIG },
      alerts: { ...DEFAULT_ALERT_PREFS },
    }
  }
}

function persist() {
  const data: PersistedConfig = { pomodoroConfig, oneShots, scheduledAlarms, dnd, alerts }
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2))
  } catch {
    // 持久化失败不阻塞运行，仅影响重启后恢复
  }
}

function snapshot() {
  return { pomodoro, oneShots, scheduledAlarms, dnd, alerts, config: pomodoroConfig, now: Date.now() }
}

function broadcast() {
  syncTooltipTimer()
  rebuildTrayMenu() // 托盘菜单含状态条目，状态变化后重建以刷新
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('alarm:changed', snapshot())
  }
}

const TOOLTIP_IDLE = 'DevWorkbench · 闹钟提醒'

/** 番茄钟运行期间每秒刷新托盘 tooltip 倒计时；空闲时清除定时器并恢复默认文案 */
function syncTooltipTimer() {
  if (pomodoro) {
    if (!tooltipTimer) {
      tooltipTimer = setInterval(() => {
        if (pomodoro) updateTrayTooltip(pomodoroTooltip(pomodoro, Date.now()))
      }, 1000)
    }
  } else if (tooltipTimer) {
    clearInterval(tooltipTimer)
    tooltipTimer = null
    updateTrayTooltip(TOOLTIP_IDLE)
  }
}

function notify(title: string, body: string) {
  const notification = new Notification({ title, body })
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
  notification.show()
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) win.flashFrame(true)
}

/** 语音播报：经 alarm-alerts 构造平台命令后启动子进程；失败静默（不影响提醒主流程） */
function speak(text: string) {
  const cmd = buildSpeakCommand(text, alerts.voiceRate, process.platform)
  if (!cmd) return
  speakProc?.kill() // 新播报打断上一段，避免多进程叠声
  try {
    const child = spawn(cmd.file, cmd.args, { stdio: 'ignore', windowsHide: true })
    child.on('error', () => {}) // 无 TTS 环境（如精简版 Windows）等错误不外泄
    child.unref()
    speakProc = child
  } catch {
    // spawn 失败忽略
  }
}

/** 增强提醒：托盘闪烁 + 桌面提醒卡 + 语音（各自受开关控制；免打扰期间不调用） */
function announce(title: string, body: string) {
  if (alerts.trayFlash) setTrayAlertFlash(true)
  if (alerts.card) showReminderCard({ title, body })
  if (alerts.voice) speak(`${title}，${body}`) // 整段文案在 buildSpeakCommand 内统一清洗
}

/** 免打扰期间静默入队（保留最近 MAX_QUEUE 条），否则立即系统通知 + 增强提醒 */
function notifyOrQueue(title: string, body: string) {
  const now = Date.now()
  if (isInDnd(now, dnd)) {
    notifyQueue.push({ title, body, at: now })
    if (notifyQueue.length > MAX_QUEUE) notifyQueue.shift()
    return
  }
  notify(title, body)
  announce(title, body)
}

/** 免打扰结束后汇总补发积压提醒 */
function flushDndQueue() {
  if (!notifyQueue.length || isInDnd(Date.now(), dnd)) return
  if (notifyQueue.length === 1) {
    const q = notifyQueue[0]
    notify(q.title, q.body)
  } else {
    const lines = notifyQueue.map((q) => `${fmtHmAt(q.at)} ${q.body}`).join('；')
    notify('免打扰期间的提醒', `共 ${notifyQueue.length} 条：${lines}`)
  }
  notifyQueue = []
}

/** 最早到期时间（null 表示当前无任务；免打扰积压待补发时把时段结束纳入候选） */
function nextFireAt(): number | null {
  const candidates = oneShots.map((t) => t.endAt)
  for (const a of scheduledAlarms) {
    if (a.enabled) candidates.push(a.nextFireAt)
  }
  if (pomodoro && pomodoro.pausedRemainingMs == null) candidates.push(pomodoro.endAt)
  if (notifyQueue.length) {
    const end = dndEndTs(Date.now(), dnd)
    if (end != null) candidates.push(end)
  }
  return candidates.length ? Math.min(...candidates) : null
}

function scheduleNext() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const next = nextFireAt()
  if (next == null) return
  const delay = Math.max(0, next - Date.now())
  timer = setTimeout(fire, delay + 50) // +50ms 缓冲避免边界提前触发
}

/** 到期检查：触发所有已到期任务（睡眠唤醒后也会立即补偿），然后重排 */
function fire() {
  const now = Date.now()

  const dueShots = oneShots.filter((t) => t.endAt <= now)
  if (dueShots.length) {
    oneShots = oneShots.filter((t) => t.endAt > now)
    persist()
    for (const t of dueShots) {
      notifyOrQueue('定时提醒', t.label || '时间到了')
    }
  }

  const dueAlarms = scheduledAlarms.filter((a) => a.enabled && a.nextFireAt <= now)
  if (dueAlarms.length) {
    for (const a of dueAlarms) {
      notifyOrQueue(`闹钟 · ${fmtHm(a.hh, a.mm)}`, a.label || '时间到了')
      if (a.repeatDaily) a.nextFireAt = resolveNextFireAt(a.hh, a.mm, now)
      else a.enabled = false
    }
    persist()
  }

  if (pomodoro && pomodoro.pausedRemainingMs == null && pomodoro.endAt <= now) {
    const prev = pomodoro
    const next = advancePomodoro(prev, pomodoroConfig, now)
    pomodoro = next
    if (prev.phase === 'work') {
      const longDue = prev.round % Math.max(1, pomodoroConfig.roundsBeforeLong) === 0
      const mins = longDue ? pomodoroConfig.longBreakMin : pomodoroConfig.breakMin
      notifyOrQueue(longDue ? '来个长休息吧' : '该休息了', `已完成第 ${prev.round} 轮专注，接下来休息 ${mins} 分钟`)
    } else {
      notifyOrQueue('休息结束', `回来继续第 ${next.round} 轮工作（${pomodoroConfig.workMin} 分钟）`)
    }
  }

  flushDndQueue()
  broadcast()
  scheduleNext()
}

// ---------- 共用动作（IPC 与托盘菜单复用） ----------

function actPomodoroStart() {
  pomodoro = createPomodoro(pomodoroConfig, Date.now())
  persist()
  scheduleNext()
  broadcast()
  return snapshot()
}

function actPomodoroPause() {
  if (pomodoro) pomodoro = pausePomodoro(pomodoro, Date.now())
  scheduleNext() // 暂停中无到期事件：重排后不再指向番茄钟
  broadcast()
  return snapshot()
}

function actPomodoroResume() {
  if (pomodoro) pomodoro = resumePomodoro(pomodoro, Date.now())
  scheduleNext()
  broadcast()
  return snapshot()
}

function actPomodoroSkip() {
  if (pomodoro) pomodoro = advancePomodoro(pomodoro, pomodoroConfig, Date.now())
  scheduleNext()
  broadcast()
  return snapshot()
}

function actPomodoroStop() {
  pomodoro = null
  scheduleNext()
  broadcast()
  return snapshot()
}

function actDndToggle() {
  dnd = { ...dnd, enabled: !dnd.enabled }
  persist()
  fire() // 重新评估：退出免打扰时立即补发积压提醒
  return snapshot()
}

/** 新增单次提醒（IPC 与托盘「25 分钟后提醒我」共用） */
function addOneShot(minutes: number, label: string) {
  const mins = Math.round(Number(minutes))
  if (!Number.isFinite(mins) || mins < 1 || mins > 24 * 60) {
    throw new Error('时长需为 1–1440 分钟')
  }
  if (oneShots.length >= MAX_ONESHOTS) throw new Error(`最多同时 ${MAX_ONESHOTS} 个提醒`)
  oneShots.push({ id: randomUUID(), label: label.trim().slice(0, 200), endAt: Date.now() + mins * 60_000 })
  persist()
  scheduleNext()
  broadcast()
}

export function registerAlarmIpc() {
  const saved = loadPersisted(Date.now())
  pomodoroConfig = saved.pomodoroConfig
  oneShots = saved.oneShots
  scheduledAlarms = saved.scheduledAlarms
  dnd = saved.dnd
  alerts = saved.alerts

  // 任务栏/托盘闪烁在任意窗口获得焦点时停止（提醒卡 focusable:false 不会触发）
  app.on('browser-window-focus', (_event, win) => {
    if (!win.isDestroyed()) win.flashFrame(false)
    setTrayAlertFlash(false)
  })

  // 提醒卡动作：稍后 → 5 分钟后按原内容重排；知道了 → 仅关闭（托盘闪烁一并停止）
  initReminderCard((action, payload) => {
    setTrayAlertFlash(false)
    if (action === 'snooze') {
      try {
        addOneShot(5, payload.body || '稍后提醒')
      } catch {
        // 队列已满等异常：提醒卡操作无 UI 反馈渠道
      }
    }
  })

  // 退出时结束未完的语音播报子进程（子进程不随主进程退出自动终止）
  app.on('before-quit', () => {
    speakProc?.kill()
  })

  // 睡眠/休眠唤醒：立即补偿触发所有过期任务并重排 setTimeout
  powerMonitor.on('resume', fire)

  ipcMain.handle('alarm:getState', () => snapshot())

  ipcMain.handle('alarm:pomodoroStart', (_event, args: { config?: Partial<PomodoroConfig> }) => {
    if (args?.config) pomodoroConfig = sanitizePomodoroConfig(args.config)
    return actPomodoroStart()
  })

  ipcMain.handle('alarm:pomodoroPause', () => actPomodoroPause())

  ipcMain.handle('alarm:pomodoroResume', () => actPomodoroResume())

  ipcMain.handle('alarm:pomodoroSkip', () => actPomodoroSkip())

  ipcMain.handle('alarm:pomodoroStop', () => actPomodoroStop())

  ipcMain.handle('alarm:oneshotAdd', (_event, args: { minutes: number; label: string }) => {
    addOneShot(Number(args?.minutes), String(args?.label ?? ''))
    return snapshot()
  })

  ipcMain.handle('alarm:oneshotRemove', (_event, args: { id: string }) => {
    const id = String(args?.id ?? '')
    oneShots = oneShots.filter((t) => t.id !== id)
    persist()
    scheduleNext()
    broadcast()
    return snapshot()
  })

  ipcMain.handle('alarm:scheduledAdd', (_event, args: { hh: number; mm: number; label: string; repeatDaily: boolean }) => {
    const hh = Math.round(Number(args?.hh))
    const mm = Math.round(Number(args?.mm))
    if (!Number.isFinite(hh) || hh < 0 || hh > 23 || !Number.isFinite(mm) || mm < 0 || mm > 59) {
      throw new Error('时间需为 0–23 时 0–59 分')
    }
    const label = String(args?.label ?? '').trim().slice(0, 200)
    if (scheduledAlarms.length >= MAX_SCHEDULED) throw new Error(`最多 ${MAX_SCHEDULED} 个时刻闹钟`)
    scheduledAlarms.push({
      id: randomUUID(),
      hh,
      mm,
      label,
      repeatDaily: !!args?.repeatDaily,
      enabled: true,
      nextFireAt: resolveNextFireAt(hh, mm, Date.now()),
    })
    persist()
    scheduleNext()
    broadcast()
    return snapshot()
  })

  ipcMain.handle('alarm:scheduledRemove', (_event, args: { id: string }) => {
    const id = String(args?.id ?? '')
    scheduledAlarms = scheduledAlarms.filter((a) => a.id !== id)
    persist()
    scheduleNext()
    broadcast()
    return snapshot()
  })

  ipcMain.handle('alarm:scheduledToggle', (_event, args: { id: string; enabled: boolean }) => {
    const alarm = scheduledAlarms.find((a) => a.id === String(args?.id ?? ''))
    if (alarm) {
      alarm.enabled = !!args?.enabled
      if (alarm.enabled) alarm.nextFireAt = resolveNextFireAt(alarm.hh, alarm.mm, Date.now())
      persist()
      scheduleNext()
      broadcast()
    }
    return snapshot()
  })

  ipcMain.handle('alarm:dndSet', (_event, args: { enabled: boolean; startMin: number; endMin: number }) => {
    dnd = sanitizeDnd(args)
    persist()
    fire() // 重新评估：退出免打扰时立即补发积压提醒
    return snapshot()
  })

  ipcMain.handle('alarm:dndToggle', () => actDndToggle())

  // 增强提醒偏好（语音/语速/提醒卡/托盘闪烁）：合并保存并广播
  ipcMain.handle('alarm:alertsSet', (_event, args: Partial<AlertPrefs>) => {
    alerts = sanitizeAlertPrefs({ ...alerts, ...(args ?? {}) })
    persist()
    broadcast()
    return snapshot()
  })

  // 语音测试：忽略开关直接播报，便于用户在设置里试听效果
  ipcMain.handle('alarm:voiceTest', () => {
    speak('语音播报测试。闹钟提醒已就绪。')
    return snapshot()
  })

  // 开机自启：注册当前可执行文件的登录启动项（开发模式下注册的是 electron.exe）
  ipcMain.handle('alarm:autoLaunchGet', () => app.getLoginItemSettings().openAtLogin)

  ipcMain.handle('alarm:autoLaunchSet', (_event, args: { enabled: boolean }) => {
    app.setLoginItemSettings({ openAtLogin: !!args?.enabled })
    rebuildTrayMenu() // 同步托盘勾选状态
    return app.getLoginItemSettings().openAtLogin
  })

  initTray({
    pomodoroStart: actPomodoroStart,
    pomodoroPause: actPomodoroPause,
    pomodoroResume: actPomodoroResume,
    pomodoroSkip: actPomodoroSkip,
    pomodoroStop: actPomodoroStop,
    oneshotQuick25: () => {
      try {
        addOneShot(25, '快速提醒')
      } catch {
        // 队列已满等异常：托盘操作无需反馈
      }
    },
    dndToggle: actDndToggle,
    autoLaunchGet: () => app.getLoginItemSettings().openAtLogin,
    autoLaunchSet: (enabled) => {
      app.setLoginItemSettings({ openAtLogin: enabled })
      rebuildTrayMenu()
    },
    getSummary: () => ({
      tooltip: pomodoroTooltip(pomodoro, Date.now()),
      pomodoroRunning: !!pomodoro,
      pomodoroPaused: pomodoro?.pausedRemainingMs != null,
      dndEnabled: dnd.enabled,
      dndLabel: `${fmtHm(Math.floor(dnd.startMin / 60), dnd.startMin % 60)}–${fmtHm(Math.floor(dnd.endMin / 60), dnd.endMin % 60)}`,
    }),
  })
}
