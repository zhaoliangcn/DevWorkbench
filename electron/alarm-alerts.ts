// 工具箱：闹钟提醒效果 —— 纯逻辑模块（无 Electron/Node IO，可单测）
// 覆盖三块增强提醒：
// - 语音播报（TTS）：把文案转成对应平台的进程命令（Windows PowerShell SAPI /
//   macOS say；Linux 无系统级 TTS 返回 null 跳过）
// - 提醒偏好（语音/提醒卡/托盘闪烁开关 + 语速）的清洗与默认值
// - 桌面提醒卡的屏幕定位（主屏工作区右下角）

export interface AlertPrefs {
  /** 语音播报开关 */
  voice: boolean
  /** 语速：Windows SAPI Rate 取值 -10~10，0 为正常 */
  voiceRate: number
  /** 桌面提醒卡（右下角滑入卡片）开关 */
  card: boolean
  /** 托盘图标闪烁开关 */
  trayFlash: boolean
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  voice: true,
  voiceRate: 0,
  card: true,
  trayFlash: true,
}

/** 语音文案最大长度（防止超长文本把 PowerShell 命令行撑爆） */
const MAX_SPEAK_LEN = 500

/** 提醒偏好清洗：非法字段回落默认值，voiceRate 取整并夹在 -10~10 */
export function sanitizeAlertPrefs(raw: unknown): AlertPrefs {
  const o = (raw ?? {}) as Partial<Record<keyof AlertPrefs, unknown>>
  const rate = Math.round(Number(o.voiceRate))
  return {
    voice: typeof o.voice === 'boolean' ? o.voice : DEFAULT_ALERT_PREFS.voice,
    voiceRate: Number.isFinite(rate) ? Math.min(10, Math.max(-10, rate)) : DEFAULT_ALERT_PREFS.voiceRate,
    card: typeof o.card === 'boolean' ? o.card : DEFAULT_ALERT_PREFS.card,
    trayFlash: typeof o.trayFlash === 'boolean' ? o.trayFlash : DEFAULT_ALERT_PREFS.trayFlash,
  }
}

/** 语音文案清洗：控制字符/换行转空格、折叠连续空白、限长（TTS 无法读换行） */
export function sanitizeSpeakText(text: string): string {
  return String(text ?? '')
    // 故意匹配控制字符以剔除（no-control-regex 为误报）
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SPEAK_LEN)
}

export interface SpeakCommand {
  file: string
  args: string[]
}

/**
 * 构造 TTS 播报命令：
 * - win32：PowerShell System.Speech（系统自带，零依赖）。单引号字符串内 '
 *   需翻倍转义；双引号在 node spawn → PowerShell 参数链路上不可靠，直接剔除
 * - darwin：say（-r 指定语速，词/分钟）
 * - 其余平台：返回 null（无系统级 TTS，调用方跳过）
 */
export function buildSpeakCommand(
  text: string,
  rate: number,
  platform: NodeJS.Platform,
): SpeakCommand | null {
  const clean = sanitizeSpeakText(text)
  if (!clean) return null
  const r = Math.round(Number(rate))
  const safeRate = Number.isFinite(r) ? Math.min(10, Math.max(-10, r)) : 0
  if (platform === 'win32') {
    const escaped = clean.replace(/"/g, '').replace(/'/g, "''")
    const script =
      `Add-Type -AssemblyName System.Speech; ` +
      `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
      `$s.Rate = ${safeRate}; ` +
      `$s.Speak('${escaped}'); ` +
      `$s.Dispose()`
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] }
  }
  if (platform === 'darwin') {
    // 语速换算：rate 0 ≈ 180 词/分，±10 档位映射 ±120，夹在 100~300
    const wpm = Math.min(300, Math.max(100, Math.round(180 + safeRate * 12)))
    return { file: 'say', args: ['-r', String(wpm), clean] }
  }
  return null
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 提醒卡定位：主屏工作区右下角，留 margin 边距；卡片超出工作区时夹回原点侧 */
export function reminderCardPosition(workArea: Rect, cardW: number, cardH: number, margin = 16): { x: number; y: number } {
  const x = Math.max(workArea.x, workArea.x + workArea.width - cardW - margin)
  const y = Math.max(workArea.y, workArea.y + workArea.height - cardH - margin)
  return { x, y }
}
