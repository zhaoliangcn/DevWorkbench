// Playwright 浏览器自动化纯逻辑（路线 B：playwright-core + 本机 Edge/Chrome）。
// 主进程 electron/ipc/browser.ts 与渲染层共用，零依赖可单测。
// 与工具箱其他 pure/* 一致：electron tsconfig rootDir 限制无法跨包共享源码，
// 主进程侧按需以极薄方式成对实现（本文件的逻辑经 IPC 参数传递复用，不复制实现）。

/** 本机浏览器通道尝试顺序：msedge（Windows 必装）→ chrome → chromium（playwright 自带，通常未安装） */
export type BrowserChannel = 'msedge' | 'chrome' | 'chromium'

export function channelAttemptSequence(): BrowserChannel[] {
  return ['msedge', 'chrome', 'chromium']
}

/**
 * URL 规范化：trim；无协议自动补 https://；仅允许 http/https
 * （自动化会话禁止 file:/javascript: 等协议，避免读取本地文件或脚本注入）。
 * 返回 null 表示非法。
 */
export function normalizeUrl(input: string): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.toString()
}

/** 压缩页面文本：去掉行尾空白、连续空行压为一行（提升 AI/面板阅读质量） */
export function compactText(text: string): string {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 截断文本并附省略标记（maxLen 为最大字符数，含标记） */
export function truncateText(text: string, maxLen: number): string {
  const s = text ?? ''
  if (maxLen <= 0) return ''
  if (s.length <= maxLen) return s
  return s.slice(0, Math.max(0, maxLen - 3)) + '...'
}

/** 截图 base64 → dataURL（渲染层 <img> 直接展示）；非法输入返回 null */
export function toPngDataUrl(base64: string): string | null {
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) return null
  return `data:image/png;base64,${base64}`
}

/** 选择器校验：非空、长度 ≤ 500。返回错误消息，合法返回 null */
export function validateSelector(selector: string): string | null {
  const s = (selector ?? '').trim()
  if (!s) return '选择器不能为空'
  if (s.length > 500) return '选择器过长（≤ 500 字符）'
  return null
}
