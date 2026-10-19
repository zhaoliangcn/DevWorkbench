import { BrowserWindow, ipcMain, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reminderCardPosition } from './alarm-alerts.js'

// 工具箱：闹钟提醒的桌面提醒卡（alarm-reminder:*）
// - 独立小窗：无边框 + 透明 + 置顶（screen-saver 级）+ 不进任务栏 + 不抢焦点
//   （focusable: false，鼠标点按钮仍有效），停驻主屏工作区右下角
// - 内容：public/reminder.html（Vite 原样拷贝进 dist，开发态走 dev server），
//   标题/正文经 query 传入，页面用 textContent 渲染（无 HTML 注入面）
// - 交互：「知道了」「稍后 5 分钟」经专用 reminder-preload 上报
//   alarm:reminderAction，由 alarm.ts 决定关闭/重排
// - 单实例：新提醒到达时旧卡直接销毁重建（最新一条优先展示）

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'

const CARD_W = 372
const CARD_H = 176
const CARD_MARGIN = 16
/** 无人处理时自动关闭（与页面内倒计时进度条时长一致） */
const AUTO_CLOSE_MS = 60_000

export interface ReminderPayload {
  title: string
  body: string
}

let cardWin: BrowserWindow | null = null
let autoCloseTimer: NodeJS.Timeout | null = null
let currentPayload: ReminderPayload | null = null
let ipcBound = false

function destroyCard() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
  }
  if (cardWin && !cardWin.isDestroyed()) cardWin.destroy()
  cardWin = null
  currentPayload = null
}

function createCard(payload: ReminderPayload) {
  const wa = screen.getPrimaryDisplay().workArea
  const pos = reminderCardPosition(
    { x: wa.x, y: wa.y, width: wa.width, height: wa.height },
    CARD_W,
    CARD_H,
    CARD_MARGIN,
  )
  const win = new BrowserWindow({
    width: CARD_W,
    height: CARD_H,
    x: pos.x,
    y: pos.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false, // 不抢焦点：弹卡不打断当前输入
    hasShadow: false,
    webPreferences: {
      preload: path.resolve(__dirname, 'reminder-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // 本地静态页：禁导航、禁开新窗，缩小攻击面
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive()
  })
  win.on('closed', () => {
    if (cardWin === win) {
      cardWin = null
      currentPayload = null
      if (autoCloseTimer) {
        clearTimeout(autoCloseTimer)
        autoCloseTimer = null
      }
    }
  })

  if (isDev) {
    const q = new URLSearchParams({ title: payload.title, body: payload.body })
    void win.loadURL(`http://localhost:5173/reminder.html?${q.toString()}`)
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'reminder.html'), {
      query: { title: payload.title, body: payload.body },
    })
  }

  cardWin = win
  currentPayload = payload
  autoCloseTimer = setTimeout(destroyCard, AUTO_CLOSE_MS)
}

/** 弹出提醒卡（已打开则销毁旧卡、展示最新一条） */
export function showReminderCard(payload: ReminderPayload) {
  destroyCard()
  createCard(payload)
}

export function closeReminderCard() {
  if (cardWin) destroyCard()
}

export function isReminderCardVisible() {
  return !!cardWin && !cardWin.isDestroyed()
}

/**
 * 注册提醒卡动作通道（alarm.ts 注册期调用一次）：
 * snooze → 5 分钟后再提醒一次；dismiss → 直接关闭
 */
export function initReminderCard(onAction: (action: 'dismiss' | 'snooze', payload: ReminderPayload) => void) {
  if (ipcBound) return
  ipcBound = true
  ipcMain.on('alarm:reminderAction', (_event, action: 'dismiss' | 'snooze') => {
    const payload = currentPayload
    destroyCard()
    if (action === 'snooze' && payload) onAction('snooze', payload)
    else onAction('dismiss', payload ?? { title: '', body: '' })
  })
}
