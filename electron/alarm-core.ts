/**
 * 闹钟/番茄钟纯状态机（无 Electron、无 IO 依赖）。
 *
 * 由主进程调度器（electron/ipc/alarm.ts）驱动——渲染进程后台会被 Chromium
 * 节流，定时逻辑必须留在主进程；本文件只做纯时间计算，便于单元测试。
 * 所有时间均为 epoch 毫秒时间戳，函数一律显式传入 now 保证可测性。
 */

export type PomodoroPhase = 'work' | 'break' | 'longBreak'

export interface PomodoroConfig {
  /** 单轮工作时长（分钟） */
  workMin: number
  /** 短休息时长（分钟） */
  breakMin: number
  /** 长休息时长（分钟） */
  longBreakMin: number
  /** 连续完成几轮工作后进入长休息 */
  roundsBeforeLong: number
}

export interface PomodoroState {
  phase: PomodoroPhase
  /** 当前工作轮号（从 1 起）；休息阶段保留刚完成/将开始的轮号 */
  round: number
  /** 本阶段结束时间（epoch ms）；暂停期间冻结 */
  endAt: number
  /** 暂停时剩余毫秒；null 表示未暂停 */
  pausedRemainingMs: number | null
}

export interface OneShot {
  id: string
  label: string
  endAt: number
}

/** 指定时刻闹钟（HH:MM，可每日重复） */
export interface ScheduledAlarm {
  id: string
  hh: number
  mm: number
  label: string
  repeatDaily: boolean
  enabled: boolean
  /** 下次触发时间（epoch ms），由主进程维护 */
  nextFireAt: number
}

/** 免打扰时段（startMin/endMin 为一天内分钟偏移 0–1439，支持跨零点） */
export interface DndConfig {
  enabled: boolean
  startMin: number
  endMin: number
}

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  workMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  roundsBeforeLong: 4,
}

const MIN = 60_000

/** 阶段时长毫秒 */
export function phaseDurationMs(phase: PomodoroPhase, config: PomodoroConfig): number {
  const min = phase === 'work' ? config.workMin : phase === 'break' ? config.breakMin : config.longBreakMin
  return min * MIN
}

/** 新建番茄钟：从第 1 轮工作开始 */
export function createPomodoro(config: PomodoroConfig, now: number): PomodoroState {
  return { phase: 'work', round: 1, endAt: now + phaseDurationMs('work', config), pausedRemainingMs: null }
}

/** 剩余毫秒（负数归零） */
export function remainingMs(endAt: number, now: number): number {
  return Math.max(0, endAt - now)
}

/** 暂停：冻结剩余时间 */
export function pausePomodoro(state: PomodoroState, now: number): PomodoroState {
  if (state.pausedRemainingMs != null) return state
  return { ...state, pausedRemainingMs: remainingMs(state.endAt, now) }
}

/** 恢复：按冻结的剩余时间平移 endAt */
export function resumePomodoro(state: PomodoroState, now: number): PomodoroState {
  if (state.pausedRemainingMs == null) return state
  return { ...state, endAt: now + state.pausedRemainingMs, pausedRemainingMs: null }
}

/**
 * 阶段结束 → 下一阶段（自动轮转）：
 * 工作结束 → 短休息（每 roundsBeforeLong 轮后长休息）；休息结束 → 下一轮工作。
 */
export function advancePomodoro(state: PomodoroState, config: PomodoroConfig, now: number): PomodoroState {
  if (state.phase === 'work') {
    const longDue = state.round % Math.max(1, config.roundsBeforeLong) === 0
    const phase: PomodoroPhase = longDue ? 'longBreak' : 'break'
    return { phase, round: state.round, endAt: now + phaseDurationMs(phase, config), pausedRemainingMs: null }
  }
  return { phase: 'work', round: state.round + 1, endAt: now + phaseDurationMs('work', config), pausedRemainingMs: null }
}

/** 倒计时格式化：mm:ss，超 1 小时 h:mm:ss */
export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 配置清洗：非法/越界值回退默认（渲染层输入不可信） */
export function sanitizePomodoroConfig(input: Partial<PomodoroConfig> | null | undefined): PomodoroConfig {
  const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }
  const d = DEFAULT_POMODORO_CONFIG
  return {
    workMin: clamp(input?.workMin, 1, 120, d.workMin),
    breakMin: clamp(input?.breakMin, 1, 60, d.breakMin),
    longBreakMin: clamp(input?.longBreakMin, 1, 90, d.longBreakMin),
    roundsBeforeLong: clamp(input?.roundsBeforeLong, 1, 10, d.roundsBeforeLong),
  }
}

// ---------- 指定时刻闹钟 / 免打扰 ----------

export const DEFAULT_DND_CONFIG: DndConfig = { enabled: false, startMin: 22 * 60, endMin: 8 * 60 }

/** HH:MM 的下一次发生：今天已过（含恰好等于 now）→ 明天同一时刻 */
export function resolveNextFireAt(hh: number, mm: number, now: number): number {
  const d = new Date(now)
  d.setHours(hh, mm, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** now 是否在免打扰时段：区间含头不含尾；start == end 视为全天 */
export function isInDnd(now: number, dnd: DndConfig): boolean {
  if (!dnd.enabled) return false
  const d = new Date(now)
  const cur = d.getHours() * 60 + d.getMinutes()
  if (dnd.startMin === dnd.endMin) return true
  if (dnd.startMin < dnd.endMin) return cur >= dnd.startMin && cur < dnd.endMin
  return cur >= dnd.startMin || cur < dnd.endMin // 跨零点
}

/** 免打扰结束时间戳（从 now 起下一次出区间的时刻）；不在免打扰中返回 null */
export function dndEndTs(now: number, dnd: DndConfig): number | null {
  if (!isInDnd(now, dnd)) return null
  const t = new Date(now)
  t.setHours(0, 0, 0, 0)
  t.setMinutes(dnd.endMin)
  if (t.getTime() <= now) t.setDate(t.getDate() + 1)
  return t.getTime()
}

/** 免打扰配置清洗：非法/越界回退钳制 */
export function sanitizeDnd(input: Partial<DndConfig> | null | undefined): DndConfig {
  const clampMin = (v: unknown, fallback: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.min(1439, Math.max(0, n)) : fallback
  }
  const d = DEFAULT_DND_CONFIG
  return {
    enabled: !!input?.enabled,
    startMin: clampMin(input?.startMin, d.startMin),
    endMin: clampMin(input?.endMin, d.endMin),
  }
}

// ---------- 托盘展示 ----------

const PHASE_LABEL: Record<PomodoroPhase, string> = { work: '专注中', break: '短休息', longBreak: '长休息' }

/** 托盘 tooltip / 菜单用的番茄钟摘要（纯函数，供单测） */
export function pomodoroTooltip(p: PomodoroState | null, now: number): string {
  if (!p) return '番茄钟未运行'
  const left = p.pausedRemainingMs ?? remainingMs(p.endAt, now)
  const paused = p.pausedRemainingMs != null ? '（已暂停）' : ''
  return `第${p.round}轮 ${PHASE_LABEL[p.phase]} ${formatCountdown(left)}${paused}`
}
