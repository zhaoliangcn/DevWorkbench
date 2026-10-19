import { useCallback, useEffect, useRef, useState } from 'react'

// 工具箱：闹钟提醒
// 调度与通知在主进程（渲染进程后台被 Chromium 节流，倒计时必须主进程驱动）：
// 渲染层仅配置/展示 —— 订阅 alarm:changed 拿绝对 endAt，本地每秒重算剩余时间。
// 番茄钟：工作/短休/长休自动轮转；单次提醒：X 分钟后通知。

interface PomodoroConfigForm {
  workMin: number
  breakMin: number
  longBreakMin: number
  roundsBeforeLong: number
}

const PHASE_LABEL: Record<string, string> = {
  work: '专注中',
  break: '短休息',
  longBreak: '长休息',
}

function fmtCountdown(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 分钟偏移 → "HH:MM"（time input 值） */
function minToTime(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`
}

/** "HH:MM" → { hh, mm }；非法返回 null */
function parseHM(v: string): { hh: number; mm: number } | null {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(v.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh > 23 || mm > 59) return null
  return { hh, mm }
}

/** 下次触发时间的人性化描述 */
function fmtNextFire(ts: number, now: number): string {
  const d = new Date(ts)
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, new Date(now))) return `今天 ${hm}`
  if (sameDay(d, new Date(now + 86_400_000))) return `明天 ${hm}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

export function AlarmTool() {
  const [snap, setSnap] = useState<AlarmSnapshot | null>(null)
  const [tick, setTick] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<PomodoroConfigForm>({ workMin: 25, breakMin: 5, longBreakMin: 15, roundsBeforeLong: 4 })
  const [shotMinutes, setShotMinutes] = useState('25')
  const [shotLabel, setShotLabel] = useState('')
  const [alarmTime, setAlarmTime] = useState('09:00')
  const [alarmLabel, setAlarmLabel] = useState('')
  const [alarmRepeat, setAlarmRepeat] = useState(true)
  const [dndForm, setDndForm] = useState({ enabled: false, start: '22:00', end: '08:00' })
  const [alertsForm, setAlertsForm] = useState<AlertPrefsInfo>({ voice: true, voiceRate: 0, card: true, trayFlash: true })
  const [autoLaunch, setAutoLaunch] = useState(false)
  const unlistenRef = useRef<(() => void) | null>(null)
  const dndInitedRef = useRef(false)
  const alertsInitedRef = useRef(false)

  // 首次拿到快照时，用已保存的免打扰配置初始化表单（此后广播不覆盖用户编辑）
  useEffect(() => {
    if (snap && !dndInitedRef.current) {
      dndInitedRef.current = true
      setDndForm({ enabled: snap.dnd.enabled, start: minToTime(snap.dnd.startMin), end: minToTime(snap.dnd.endMin) })
    }
    if (snap && !alertsInitedRef.current) {
      alertsInitedRef.current = true
      setAlertsForm({ ...snap.alerts })
    }
  }, [snap])

  useEffect(() => {
    let alive = true
    const api = window.electronAPI?.alarm
    if (!api) return
    api
      .getState()
      .then((s) => {
        if (alive) setSnap(s)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    unlistenRef.current = api.onAlarmChanged((s) => setSnap(s))
    api
      .autoLaunchGet()
      .then((v) => {
        if (alive) setAutoLaunch(v)
      })
      .catch(() => {})
    const t = setInterval(() => setTick(Date.now()), 1000)
    return () => {
      alive = false
      unlistenRef.current?.()
      unlistenRef.current = null
      clearInterval(t)
    }
  }, [])

  const act = useCallback(async (fn: (api: NonNullable<Window['electronAPI']>['alarm']) => Promise<AlarmSnapshot>) => {
    const api = window.electronAPI?.alarm
    if (!api) return
    setError('')
    setBusy(true)
    try {
      setSnap(await fn(api))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const pomo = snap?.pomodoro ?? null
  const running = !!pomo
  const paused = pomo?.pausedRemainingMs != null
  // 剩余时间：暂停用冻结值，运行中用 endAt - now（本地每秒重算，主进程只管到点触发）
  const pomoLeft = pomo ? (pomo.pausedRemainingMs ?? Math.max(0, pomo.endAt - tick)) : 0

  const startPomodoro = () =>
    act((api) => api.pomodoroStart({ config: form }))
  const addShot = () =>
    act(async (api) => {
      const minutes = Number(shotMinutes)
      if (!Number.isFinite(minutes) || minutes < 1) throw new Error('请输入有效分钟数（≥1）')
      return api.oneshotAdd({ minutes, label: shotLabel.trim() })
    })
  const addScheduled = () =>
    act(async (api) => {
      const t = parseHM(alarmTime)
      if (!t) throw new Error('请选择有效时间')
      return api.scheduledAdd({ hh: t.hh, mm: t.mm, label: alarmLabel.trim(), repeatDaily: alarmRepeat })
    })
  const saveDnd = () =>
    act(async (api) => {
      const s = parseHM(dndForm.start)
      const e = parseHM(dndForm.end)
      if (!s || !e) throw new Error('免打扰时段需为有效的 HH:MM')
      return api.dndSet({ enabled: dndForm.enabled, startMin: s.hh * 60 + s.mm, endMin: e.hh * 60 + e.mm })
    })
  // 提醒效果改动即保存（主进程合并清洗后广播新快照）
  const saveAlerts = (next: AlertPrefsInfo) => {
    setAlertsForm(next)
    void act((api) => api.alertsSet(next))
  }
  const testVoice = () => act((api) => api.voiceTest())
  const toggleAutoLaunch = async (enabled: boolean) => {
    const api = window.electronAPI?.alarm
    if (!api) return
    setError('')
    try {
      setAutoLaunch(await api.autoLaunchSet({ enabled }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const configInputs: { key: keyof PomodoroConfigForm; label: string; max: number }[] = [
    { key: 'workMin', label: '工作（分钟）', max: 120 },
    { key: 'breakMin', label: '短休息（分钟）', max: 60 },
    { key: 'longBreakMin', label: '长休息（分钟）', max: 90 },
    { key: 'roundsBeforeLong', label: '几轮后长休息', max: 10 },
  ]

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>闹钟提醒</h3>
      </div>
      <div className="tool-body">
        {/* 番茄钟 */}
        <div className="tool-section" style={{ textAlign: 'center' }}>
          <p style={{ margin: '8px 0', opacity: 0.75 }}>
            {running
              ? `第 ${pomo!.round} 轮 · ${PHASE_LABEL[pomo!.phase]}${paused ? '（已暂停）' : ''}`
              : '番茄钟未开始'}
          </p>
          <p style={{ fontSize: 56, fontWeight: 700, margin: '8px 0', fontVariantNumeric: 'tabular-nums' }}>
            {running ? fmtCountdown(pomoLeft) : '--:--'}
          </p>
          {!running ? (
            <>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  margin: '12px 0',
                }}
              >
                {configInputs.map((c) => (
                  <label key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                    {c.label}
                    <input
                      type="number"
                      min={1}
                      max={c.max}
                      value={form[c.key]}
                      onChange={(e) => setForm({ ...form, [c.key]: Math.max(1, Number(e.target.value) || 1) })}
                      style={{ width: 90 }}
                    />
                  </label>
                ))}
              </div>
              <div className="tool-actions">
                <button onClick={startPomodoro} disabled={busy}>
                  开始专注
                </button>
              </div>
            </>
          ) : (
            <div className="tool-actions" style={{ justifyContent: 'center' }}>
              {paused ? (
                <button onClick={() => act((api) => api.pomodoroResume())} disabled={busy}>
                  继续
                </button>
              ) : (
                <button onClick={() => act((api) => api.pomodoroPause())} disabled={busy}>
                  暂停
                </button>
              )}
              <button onClick={() => act((api) => api.pomodoroSkip())} disabled={busy}>
                跳过本阶段
              </button>
              <button onClick={() => act((api) => api.pomodoroStop())} disabled={busy}>
                停止
              </button>
            </div>
          )}
          <p className="hint">到点弹系统通知 + 任务栏闪烁；工作/休息自动轮转，第 {form.roundsBeforeLong} 轮后长休息</p>
        </div>

        {/* 单次提醒 */}
        <div className="tool-section">
          <h4>单次提醒</h4>
          <div className="form-row">
            <label>分钟</label>
            <input
              type="number"
              min={1}
              max={1440}
              value={shotMinutes}
              onChange={(e) => setShotMinutes(e.target.value)}
              style={{ width: 90 }}
            />
          </div>
          <div className="form-row">
            <label>提醒内容</label>
            <input
              value={shotLabel}
              onChange={(e) => setShotLabel(e.target.value)}
              placeholder="如：喝水 / 站起来活动 / 汇报前准备"
            />
          </div>
          <div className="tool-actions">
            <button onClick={addShot} disabled={busy}>
              添加提醒
            </button>
          </div>
          {snap?.oneShots?.length ? (
            <div style={{ margin: '8px 0' }}>
              {[...snap.oneShots]
                .sort((a, b) => a.endAt - b.endAt)
                .map((t) => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.label || '提醒'}{' '}
                      <span style={{ opacity: 0.65 }}>· 还剩 {fmtCountdown(Math.max(0, t.endAt - tick))}</span>
                    </span>
                    <button onClick={() => act((api) => api.oneshotRemove({ id: t.id }))} title="移除">
                      ✕
                    </button>
                  </div>
                ))}
            </div>
          ) : (
            <p className="hint">暂无待触发提醒</p>
          )}
        </div>

        {/* 指定时刻闹钟 */}
        <div className="tool-section">
          <h4>指定时刻闹钟</h4>
          <div className="form-row">
            <label>时间</label>
            <input type="time" value={alarmTime} onChange={(e) => setAlarmTime(e.target.value)} />
          </div>
          <div className="form-row">
            <label>事项</label>
            <input value={alarmLabel} onChange={(e) => setAlarmLabel(e.target.value)} placeholder="如：每日站会 / 起床" />
          </div>
          <div className="form-row">
            <label>
              <input type="checkbox" checked={alarmRepeat} onChange={(e) => setAlarmRepeat(e.target.checked)} /> 每天重复
            </label>
          </div>
          <div className="tool-actions">
            <button onClick={addScheduled} disabled={busy}>
              添加闹钟
            </button>
          </div>
          {snap?.scheduledAlarms?.length ? (
            <div style={{ margin: '8px 0' }}>
              {[...snap.scheduledAlarms]
                .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.nextFireAt - b.nextFireAt)
                .map((a) => (
                  <div
                    key={a.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', opacity: a.enabled ? 1 : 0.5 }}
                  >
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {pad2(a.hh)}:{pad2(a.mm)}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.label || '闹钟'}{' '}
                      <span style={{ opacity: 0.65 }}>
                        · {a.repeatDaily ? '每天' : '单次'}
                        {a.enabled ? ` · ${fmtNextFire(a.nextFireAt, tick)}` : ' · 已停用'}
                      </span>
                    </span>
                    <button onClick={() => act((api) => api.scheduledToggle({ id: a.id, enabled: !a.enabled }))}>
                      {a.enabled ? '停用' : '启用'}
                    </button>
                    <button onClick={() => act((api) => api.scheduledRemove({ id: a.id }))} title="删除">
                      ✕
                    </button>
                  </div>
                ))}
            </div>
          ) : (
            <p className="hint">暂无时刻闹钟</p>
          )}
        </div>

        {/* 免打扰时段 */}
        <div className="tool-section">
          <h4>免打扰时段</h4>
          <div className="form-row">
            <label>
              <input
                type="checkbox"
                checked={dndForm.enabled}
                onChange={(e) => setDndForm({ ...dndForm, enabled: e.target.checked })}
              />{' '}
              启用免打扰
            </label>
          </div>
          <div className="form-row">
            <label>开始</label>
            <input type="time" value={dndForm.start} onChange={(e) => setDndForm({ ...dndForm, start: e.target.value })} />
            <label>结束</label>
            <input type="time" value={dndForm.end} onChange={(e) => setDndForm({ ...dndForm, end: e.target.value })} />
          </div>
          <div className="tool-actions">
            <button onClick={saveDnd} disabled={busy}>
              保存
            </button>
          </div>
          <p className="hint">免打扰期间新到提醒静默入队（最多保留 20 条），时段结束后汇总补发；支持跨零点时段（如 22:00–08:00）</p>
        </div>

        {/* 提醒效果 */}
        <div className="tool-section">
          <h4>提醒效果</h4>
          <div className="form-row">
            <label>
              <input
                type="checkbox"
                checked={alertsForm.voice}
                onChange={(e) => saveAlerts({ ...alertsForm, voice: e.target.checked })}
              />{' '}
              语音播报
            </label>
            <select
              value={alertsForm.voiceRate}
              onChange={(e) => saveAlerts({ ...alertsForm, voiceRate: Number(e.target.value) })}
              style={{ width: 90 }}
            >
              <option value={-4}>很慢</option>
              <option value={-2}>慢速</option>
              <option value={0}>正常</option>
              <option value={2}>快速</option>
              <option value={4}>很快</option>
            </select>
            <button onClick={testVoice} disabled={busy}>
              试听
            </button>
          </div>
          <div className="form-row">
            <label>
              <input
                type="checkbox"
                checked={alertsForm.card}
                onChange={(e) => saveAlerts({ ...alertsForm, card: e.target.checked })}
              />{' '}
              桌面提醒卡（右下角滑入，可「稍后 5 分钟」）
            </label>
          </div>
          <div className="form-row">
            <label>
              <input
                type="checkbox"
                checked={alertsForm.trayFlash}
                onChange={(e) => saveAlerts({ ...alertsForm, trayFlash: e.target.checked })}
              />{' '}
              托盘图标闪烁
            </label>
          </div>
          <p className="hint">
            到点在系统通知之外追加：语音朗读、右下角提醒卡（60 秒自动关闭，弹出不抢焦点）、托盘闪烁（点开任意窗口后停止）；三项独立开关，免打扰期间不触发
          </p>
        </div>

        {/* 应用 */}
        <div className="tool-section">
          <h4>应用</h4>
          <div className="form-row">
            <label>
              <input type="checkbox" checked={autoLaunch} onChange={(e) => toggleAutoLaunch(e.target.checked)} /> 开机自启
            </label>
          </div>
          <p className="hint">登录时自动启动应用，托盘图标常驻（倒计时见托盘 tooltip），闹钟到点照常提醒；打包安装后更可靠，开发模式注册的是 electron.exe</p>
        </div>

        {error && <p style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
      </div>
    </div>
  )
}
