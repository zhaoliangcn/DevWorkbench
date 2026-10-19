import { contextBridge, ipcRenderer } from 'electron'

// 工具箱：闹钟提醒卡专用 preload（仅暴露动作上报，最小桥面）
// 提醒卡是独立小窗（public/reminder.html），不复用主窗口的全量 electronAPI

contextBridge.exposeInMainWorld('reminderAPI', {
  /** 上报按钮动作：dismiss=知道了关闭；snooze=稍后 5 分钟再提醒 */
  action: (action: 'dismiss' | 'snooze') => ipcRenderer.send('alarm:reminderAction', action),
})
