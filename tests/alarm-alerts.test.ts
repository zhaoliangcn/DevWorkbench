// 工具箱：闹钟提醒效果纯逻辑测试（electron/alarm-alerts.ts）
// 覆盖：偏好清洗（非法回落默认/语速夹取）、语音文案清洗、
// TTS 命令构造（win32 PowerShell 转义 / darwin say / 其他平台跳过）、提醒卡定位
import { describe, it, expect } from 'vitest'
import {
  buildSpeakCommand,
  DEFAULT_ALERT_PREFS,
  reminderCardPosition,
  sanitizeAlertPrefs,
  sanitizeSpeakText,
} from '../electron/alarm-alerts'

describe('sanitizeAlertPrefs', () => {
  it('undefined/非对象 → 全默认', () => {
    expect(sanitizeAlertPrefs(undefined)).toEqual(DEFAULT_ALERT_PREFS)
    expect(sanitizeAlertPrefs(null)).toEqual(DEFAULT_ALERT_PREFS)
    expect(sanitizeAlertPrefs('x')).toEqual(DEFAULT_ALERT_PREFS)
  })

  it('合法字段保留，非法字段回落', () => {
    expect(
      sanitizeAlertPrefs({ voice: false, voiceRate: 3, card: false, trayFlash: false }),
    ).toEqual({ voice: false, voiceRate: 3, card: false, trayFlash: false })
    const partial = sanitizeAlertPrefs({ voice: false })
    expect(partial.voice).toBe(false)
    expect(partial.voiceRate).toBe(DEFAULT_ALERT_PREFS.voiceRate)
    expect(partial.card).toBe(DEFAULT_ALERT_PREFS.card)
    expect(partial.trayFlash).toBe(DEFAULT_ALERT_PREFS.trayFlash)
  })

  it('语速取整并夹在 -10~10', () => {
    expect(sanitizeAlertPrefs({ voiceRate: 2.6 }).voiceRate).toBe(3)
    expect(sanitizeAlertPrefs({ voiceRate: -99 }).voiceRate).toBe(-10)
    expect(sanitizeAlertPrefs({ voiceRate: 99 }).voiceRate).toBe(10)
    expect(sanitizeAlertPrefs({ voiceRate: 'abc' }).voiceRate).toBe(0)
  })
})

describe('sanitizeSpeakText', () => {
  it('换行/控制字符转空格并折叠', () => {
    expect(sanitizeSpeakText('第一行\n第二行\t制表\u0007符')).toBe('第一行 第二行 制表 符')
    expect(sanitizeSpeakText('  多   空格  ')).toBe('多 空格')
  })

  it('限长 500 字符', () => {
    expect(sanitizeSpeakText('a'.repeat(600)).length).toBe(500)
  })

  it('空入参 → 空串', () => {
    expect(sanitizeSpeakText('')).toBe('')
  })
})

describe('buildSpeakCommand', () => {
  it('win32：PowerShell System.Speech，单引号翻倍转义、剔除双引号', () => {
    const cmd = buildSpeakCommand("开会啦：带 '伞' 和 \"笔记本\"", 0, 'win32')
    expect(cmd).not.toBeNull()
    expect(cmd!.file).toBe('powershell.exe')
    const script = cmd!.args.at(-1)!
    expect(cmd!.args.slice(0, 2)).toEqual(['-NoProfile', '-NonInteractive'])
    expect(script).toContain('$s.Rate = 0;')
    // ' → ''；" 被剔除
    expect(script).toContain("$s.Speak('开会啦：带 ''伞'' 和 笔记本');")
    expect(script).not.toContain('"')
  })

  it('win32：语速夹取到 -10~10', () => {
    const cmd = buildSpeakCommand('文本', 99, 'win32')
    expect(cmd!.args.at(-1)).toContain('$s.Rate = 10;')
  })

  it('darwin：say 命令，rate 0 → 180 词/分', () => {
    const cmd = buildSpeakCommand('hello world', 0, 'darwin')
    expect(cmd).toEqual({ file: 'say', args: ['-r', '180', 'hello world'] })
  })

  it('darwin：语速换算夹在 100~300', () => {
    expect(buildSpeakCommand('hi', 10, 'darwin')!.args[1]).toBe('300')
    expect(buildSpeakCommand('hi', -10, 'darwin')!.args[1]).toBe('100')
  })

  it('darwin：引号原样保留（spawn 直传参数，无 shell 解析）', () => {
    const cmd = buildSpeakCommand("say 'quoted'", 0, 'darwin')
    expect(cmd!.args[2]).toBe("say 'quoted'")
  })

  it('其他平台 → null（跳过语音）', () => {
    expect(buildSpeakCommand('文本', 0, 'linux')).toBeNull()
    expect(buildSpeakCommand('文本', 0, 'freebsd' as NodeJS.Platform)).toBeNull()
  })

  it('空文案 → null', () => {
    expect(buildSpeakCommand('   \n ', 0, 'win32')).toBeNull()
  })
})

describe('reminderCardPosition', () => {
  it('常规屏幕：主屏工作区右下角留边距', () => {
    const wa = { x: 0, y: 0, width: 1920, height: 1040 }
    expect(reminderCardPosition(wa, 372, 176, 16)).toEqual({ x: 1920 - 372 - 16, y: 1040 - 176 - 16 })
  })

  it('带任务栏偏移的工作区（x/y 非 0）同样右下对齐', () => {
    const wa = { x: 0, y: 0, width: 2560, height: 1400 }
    const p = reminderCardPosition(wa, 372, 176, 16)
    expect(p).toEqual({ x: 2560 - 388, y: 1400 - 192 })
  })

  it('卡片大于工作区时夹回工作区原点侧', () => {
    const wa = { x: 100, y: 50, width: 300, height: 120 }
    const p = reminderCardPosition(wa, 372, 176, 16)
    expect(p).toEqual({ x: 100, y: 50 })
  })
})
