import { Tray, Menu, app, nativeImage, BrowserWindow } from 'electron'

// 工具箱：闹钟提醒的系统托盘
// - 图标：无现成位图资源（favicon.svg 无法被 nativeImage 光栅化），用 32x32
//   BGRA 原始像素绘制（蓝色圆角方块 + 白色铃铛），零资源依赖
// - 倒计时：Windows 托盘无文本通道，秒级倒计时放 tooltip（alarm.ts 每秒推送），
//   菜单内状态条目仅在重建时刷新
// - 菜单：番茄钟快捷控制 / 25 分钟快速提醒 / 免打扰开关 / 开机自启 / 退出

export interface TrayController {
  pomodoroStart(): void
  pomodoroPause(): void
  pomodoroResume(): void
  pomodoroSkip(): void
  pomodoroStop(): void
  oneshotQuick25(): void
  dndToggle(): void
  autoLaunchGet(): boolean
  autoLaunchSet(enabled: boolean): void
  /** 托盘菜单渲染所需的当前状态 */
  getSummary(): {
    tooltip: string
    pomodoroRunning: boolean
    pomodoroPaused: boolean
    dndEnabled: boolean
    dndLabel: string
  }
}

let tray: Tray | null = null
let controller: TrayController | null = null

/** 32x32 BGRA 像素绘制托盘图标：圆角方块 + 白色铃铛（默认蓝色，提醒态传红色） */
function createTrayIcon(br = 0x3b, bg = 0x82, bb = 0xf6) {
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  const set = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    buf[i] = b // BGRA 字节序
    buf[i + 1] = g
    buf[i + 2] = r
    buf[i + 3] = a
  }
  const radius = 7
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(radius - x, x - (size - 1 - radius), 0)
      const dy = Math.max(radius - y, y - (size - 1 - radius), 0)
      if (Math.hypot(dx, dy) <= radius) set(x, y, br, bg, bb)
    }
  }
  const cx = 16
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x - cx, y - 13) <= 6) set(x, y, 255, 255, 255) // 铃体
      if (y === 21 && Math.abs(x - cx) <= 8) set(x, y, 255, 255, 255) // 铃口横杠
      if (y === 24 && Math.abs(x - cx) <= 3) set(x, y, 255, 255, 255) // 铃锤
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

function showMainWindow() {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function rebuildMenu() {
  if (!tray || !controller) return
  const s = controller.getSummary()
  const pomodoroItems: Electron.MenuItemConstructorOptions[] = s.pomodoroRunning
    ? [
        { label: s.pomodoroPaused ? '继续' : '暂停', click: () => (s.pomodoroPaused ? controller!.pomodoroResume() : controller!.pomodoroPause()) },
        { label: '跳过本阶段', click: () => controller!.pomodoroSkip() },
        { label: '停止', click: () => controller!.pomodoroStop() },
      ]
    : [{ label: '开始专注（25 分钟）', click: () => controller!.pomodoroStart() }]

  const menu: Electron.MenuItemConstructorOptions[] = [
    { label: '显示主窗口', click: showMainWindow },
    { type: 'separator' },
    { label: s.tooltip, enabled: false },
    ...pomodoroItems,
    { type: 'separator' },
    { label: '25 分钟后提醒我', click: () => controller!.oneshotQuick25() },
    { label: `免打扰（${s.dndLabel}）：${s.dndEnabled ? '已开启' : '已关闭'}`, click: () => controller!.dndToggle() },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: controller.autoLaunchGet(),
      click: (item) => controller!.autoLaunchSet(item.checked),
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(menu))
}

/** 状态变化后重建托盘菜单（幂等；未初始化时为空操作） */
export function rebuildTrayMenu() {
  rebuildMenu()
}

/** 托盘 tooltip 更新（alarm.ts 每秒推送番茄钟倒计时） */
export function updateTrayTooltip(text: string) {
  tray?.setToolTip(text)
}

// ---------- 提醒闪烁：蓝/红图标交替，直到用户处理（处理动作/主窗聚焦时停止） ----------

let flashTimer: NodeJS.Timeout | null = null
let flashPhase = false

/** 设置托盘提醒闪烁（幂等）：active=true 开始交替，false 恢复常驻图标 */
export function setTrayAlertFlash(active: boolean) {
  if (!tray) return
  if (active) {
    if (flashTimer) return
    flashPhase = true
    tray.setImage(createTrayIcon(0xe5, 0x48, 0x4d))
    flashTimer = setInterval(() => {
      flashPhase = !flashPhase
      tray?.setImage(flashPhase ? createTrayIcon() : createTrayIcon(0xe5, 0x48, 0x4d))
    }, 500)
  } else if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
    tray.setImage(createTrayIcon())
  }
}

export function initTray(ctrl: TrayController) {
  if (tray) return
  controller = ctrl
  tray = new Tray(createTrayIcon())
  tray.setToolTip('DevWorkbench · 闹钟提醒')
  tray.on('click', showMainWindow)
  rebuildMenu()
}
