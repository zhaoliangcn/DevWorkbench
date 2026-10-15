// 工具箱：闹钟/番茄钟状态机测试（electron/alarm-core.ts）
// 覆盖：阶段轮转（work→break/longBreak→work）、暂停/恢复时间平移、
// 倒计时格式化、配置清洗边界
import { describe, it, expect } from 'vitest'
import {
  advancePomodoro,
  createPomodoro,
  DEFAULT_POMODORO_CONFIG,
  dndEndTs,
  formatCountdown,
  isInDnd,
  pausePomodoro,
  pomodoroTooltip,
  remainingMs,
  resolveNextFireAt,
  resumePomodoro,
  sanitizeDnd,
  sanitizePomodoroConfig,
} from '../electron/alarm-core'

const NOW = 1_700_000_000_000
const cfg = { ...DEFAULT_POMODORO_CONFIG }

describe('番茄钟轮转', () => {
  it('新建：第 1 轮工作，endAt = now + workMin', () => {
    const s = createPomodoro(cfg, NOW)
    expect(s).toEqual({ phase: 'work', round: 1, endAt: NOW + 25 * 60_000, pausedRemainingMs: null })
  })

  it('工作结束（未到长休息轮）→ 短休息', () => {
    const next = advancePomodoro(createPomodoro(cfg, NOW), cfg, NOW)
    expect(next.phase).toBe('break')
    expect(next.round).toBe(1)
    expect(next.endAt).toBe(NOW + 5 * 60_000)
  })

  it('第 4 轮工作结束 → 长休息', () => {
    let s = createPomodoro(cfg, NOW)
    // 3 轮工作+短休 → 第 4 轮工作
    for (let i = 0; i < 6; i++) s = advancePomodoro(s, cfg, NOW)
    expect(s.phase).toBe('work')
    expect(s.round).toBe(4)
    const long = advancePomodoro(s, cfg, NOW)
    expect(long.phase).toBe('longBreak')
    expect(long.endAt).toBe(NOW + 15 * 60_000)
  })

  it('休息结束 → 下一轮工作（round+1）', () => {
    const brk = advancePomodoro(createPomodoro(cfg, NOW), cfg, NOW)
    const work = advancePomodoro(brk, cfg, NOW)
    expect(work.phase).toBe('work')
    expect(work.round).toBe(2)
  })

  it('轮转后新阶段从当前时刻重新计时', () => {
    const s = createPomodoro(cfg, NOW)
    const next = advancePomodoro(s, cfg, NOW + 25 * 60_000)
    expect(next.endAt).toBe(NOW + 25 * 60_000 + 5 * 60_000)
  })
})

describe('暂停 / 恢复', () => {
  it('暂停冻结剩余时间，恢复时平移 endAt', () => {
    const s = createPomodoro(cfg, NOW)
    const at = NOW + 10 * 60_000 // 工作 10 分钟后暂停
    const paused = pausePomodoro(s, at)
    expect(paused.pausedRemainingMs).toBe(15 * 60_000)
    // 暂停 5 分钟后恢复
    const resumed = resumePomodoro(paused, at + 5 * 60_000)
    expect(resumed.pausedRemainingMs).toBeNull()
    expect(resumed.endAt).toBe(at + 5 * 60_000 + 15 * 60_000)
  })

  it('重复暂停/未暂停恢复为幂等', () => {
    const s = createPomodoro(cfg, NOW)
    expect(pausePomodoro(pausePomodoro(s, NOW), NOW + 1)).toEqual(pausePomodoro(s, NOW))
    expect(resumePomodoro(s, NOW)).toBe(s)
  })
})

describe('remainingMs / formatCountdown', () => {
  it('剩余毫秒，过期归零', () => {
    expect(remainingMs(NOW + 5_000, NOW)).toBe(5_000)
    expect(remainingMs(NOW - 5_000, NOW)).toBe(0)
  })

  it('mm:ss 与 h:mm:ss 格式', () => {
    expect(formatCountdown(65_000)).toBe('01:05')
    expect(formatCountdown(3_661_000)).toBe('1:01:01')
    expect(formatCountdown(0)).toBe('00:00')
  })
})

describe('sanitizePomodoroConfig', () => {
  it('合法值保留', () => {
    expect(sanitizePomodoroConfig({ workMin: 45, breakMin: 10, longBreakMin: 20, roundsBeforeLong: 3 })).toEqual({
      workMin: 45,
      breakMin: 10,
      longBreakMin: 20,
      roundsBeforeLong: 3,
    })
  })

  it('越界/非法值回退钳制', () => {
    const d = DEFAULT_POMODORO_CONFIG
    expect(sanitizePomodoroConfig({ workMin: 9999 }).workMin).toBe(120)
    expect(sanitizePomodoroConfig({ workMin: 0 }).workMin).toBe(1)
    expect(sanitizePomodoroConfig({ roundsBeforeLong: Number.NaN })).toEqual({ ...d, roundsBeforeLong: d.roundsBeforeLong })
    expect(sanitizePomodoroConfig({ roundsBeforeLong: 2.7 }).roundsBeforeLong).toBe(3)
    expect(sanitizePomodoroConfig(null)).toEqual(d)
  })
})

// ---------- P1：指定时刻闹钟 / 免打扰 ----------

/** 本地时区构造时间戳（避免 UTC 假设） */
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe('resolveNextFireAt', () => {
  const now = at(2026, 10, 14, 10, 0)

  it('今天已过 → 明天同一时刻', () => {
    expect(resolveNextFireAt(9, 0, now)).toBe(at(2026, 10, 15, 9, 0))
  })

  it('今天未到 → 今天', () => {
    expect(resolveNextFireAt(21, 30, now)).toBe(at(2026, 10, 14, 21, 30))
  })

  it('恰好等于 now → 明天（避免立即触发的循环）', () => {
    expect(resolveNextFireAt(10, 0, now)).toBe(at(2026, 10, 15, 10, 0))
  })
})

describe('免打扰 isInDnd / dndEndTs', () => {
  const day = { enabled: true, startMin: 9 * 60, endMin: 12 * 60 }
  const night = { enabled: true, startMin: 22 * 60, endMin: 8 * 60 }

  it('同日区间：含头不含尾', () => {
    expect(isInDnd(at(2026, 10, 14, 9, 0), day)).toBe(true)
    expect(isInDnd(at(2026, 10, 14, 10, 30), day)).toBe(true)
    expect(isInDnd(at(2026, 10, 14, 12, 0), day)).toBe(false)
  })

  it('跨零点区间（22:00–08:00）', () => {
    expect(isInDnd(at(2026, 10, 14, 23, 0), night)).toBe(true)
    expect(isInDnd(at(2026, 10, 15, 3, 0), night)).toBe(true)
    expect(isInDnd(at(2026, 10, 14, 12, 0), night)).toBe(false)
  })

  it('start == end 视为全天；未启用返回 false', () => {
    expect(isInDnd(at(2026, 10, 14, 12, 0), { enabled: true, startMin: 600, endMin: 600 })).toBe(true)
    expect(isInDnd(at(2026, 10, 14, 10, 0), { ...day, enabled: false })).toBe(false)
  })

  it('dndEndTs：跨零点指向下一个结束时刻', () => {
    expect(dndEndTs(at(2026, 10, 14, 23, 0), night)).toBe(at(2026, 10, 15, 8, 0))
    expect(dndEndTs(at(2026, 10, 15, 3, 0), night)).toBe(at(2026, 10, 15, 8, 0))
    expect(dndEndTs(at(2026, 10, 14, 12, 0), night)).toBeNull()
  })
})

describe('sanitizeDnd', () => {
  it('越界钳制与默认值', () => {
    expect(sanitizeDnd({ enabled: true, startMin: 1500, endMin: -5 })).toEqual({
      enabled: true,
      startMin: 1439,
      endMin: 0,
    })
    expect(sanitizeDnd(null)).toEqual({ enabled: false, startMin: 22 * 60, endMin: 8 * 60 })
    expect(sanitizeDnd({ startMin: Number.NaN, endMin: 480 })).toEqual({ enabled: false, startMin: 22 * 60, endMin: 480 })
  })
})

// ---------- P2：托盘摘要 ----------

describe('pomodoroTooltip', () => {
  it('空闲 → 未运行文案', () => {
    expect(pomodoroTooltip(null, NOW)).toBe('番茄钟未运行')
  })

  it('运行中 → 第 N 轮 阶段 剩余倒计时', () => {
    const s = createPomodoro(cfg, NOW)
    expect(pomodoroTooltip(s, NOW)).toBe('第1轮 专注中 25:00')
    expect(pomodoroTooltip(s, NOW + 10 * 60_000)).toBe('第1轮 专注中 15:00')
  })

  it('暂停 → 冻结剩余时间并标注（已暂停）', () => {
    const paused = pausePomodoro(createPomodoro(cfg, NOW), NOW + 10 * 60_000)
    expect(pomodoroTooltip(paused, NOW + 20 * 60_000)).toBe('第1轮 专注中 15:00（已暂停）')
  })
})
