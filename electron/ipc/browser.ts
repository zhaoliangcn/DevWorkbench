// Playwright 浏览器自动化（路线 B：playwright-core 驱动本机 Edge/Chrome，零浏览器二进制下载）。
//
// 两个能力面：
// 1. headless 自动化会话：工具箱面板操作 + AI 助手工具集（assistant-tools.ts 复用内部函数）
// 2. 受管浏览子窗口：Electron 原生 BrowserWindow 承载日常浏览（无 preload，远程页面拿不到桥）
//
// 安全：
// - 仅允许 http/https（与 src/.../pure/browser.ts normalizeUrl 成对实现，rootDir 限制无法共享源码）
// - 子窗口无 preload/nodeIntegration，windowOpenHandler 转系统浏览器，权限请求全拒
// - AI 工具不暴露任意 JS evaluate，仅 locator 语义（open/text/click/fill）

import { BrowserWindow, ipcMain, shell } from 'electron'
import { chromium, type Browser, type Page } from 'playwright-core'

type BrowserChannel = 'msedge' | 'chrome' | 'chromium'

// —— 与 pure/browser.ts 成对的极薄实现（勿增逻辑） ——

function channelAttemptSequence(): BrowserChannel[] {
  return ['msedge', 'chrome', 'chromium']
}

function normalizeUrl(input: string): string | null {
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

function compactText(text: string): string {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncateText(text: string, maxLen: number): string {
  const s = text ?? ''
  if (maxLen <= 0) return ''
  if (s.length <= maxLen) return s
  return s.slice(0, Math.max(0, maxLen - 3)) + '...'
}

function validateSelector(selector: string): string | null {
  const s = (selector ?? '').trim()
  if (!s) return '选择器不能为空'
  if (s.length > 500) return '选择器过长（≤ 500 字符）'
  return null
}

// —— 自动化会话 ——

interface AutoSession {
  browser: Browser
  page: Page
  channel: BrowserChannel
  url: string
  title: string
}

const sessions = new Map<string, AutoSession>()
let sessionSeq = 0
let activeSessionId: string | null = null

const GOTO_TIMEOUT = 30_000
const LOCATOR_TIMEOUT = 5_000
const TEXT_MAX = 20_000

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 按通道顺序尝试启动 headless 浏览器；全部失败抛错（提示安装 Edge/Chrome） */
async function launchHeadless(): Promise<{ browser: Browser; channel: BrowserChannel }> {
  let lastErr = ''
  for (const channel of channelAttemptSequence()) {
    try {
      const browser = await chromium.launch({
        channel: channel === 'chromium' ? undefined : channel,
        headless: true,
      })
      return { browser, channel }
    } catch (e) {
      lastErr = errMessage(e)
    }
  }
  throw new Error(`未找到可用浏览器（需已安装 Edge 或 Chrome）：${lastErr}`)
}

async function ensureAutoSession(url?: string): Promise<{ success: boolean; sessionId?: string; channel?: string; title?: string; error?: string }> {
  try {
    let session = activeSessionId ? sessions.get(activeSessionId) : undefined
    if (!session) {
      const { browser, channel } = await launchHeadless()
      const page = await browser.newPage()
      sessionSeq += 1
      const id = `s${sessionSeq}`
      session = { browser, page, channel, url: '', title: '' }
      sessions.set(id, session)
      activeSessionId = id
    }
    if (url) {
      const normalized = normalizeUrl(url)
      if (!normalized) return { success: false, error: 'URL 非法（仅支持 http/https）' }
      await session.page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT })
      session.url = normalized
      session.title = await session.page.title()
    }
    return { success: true, sessionId: activeSessionId!, channel: session.channel, title: session.title }
  } catch (e) {
    return { success: false, error: errMessage(e) }
  }
}

function requireActiveSession(): AutoSession | null {
  return activeSessionId ? sessions.get(activeSessionId) ?? null : null
}

function statusSnapshot() {
  return {
    activeId: activeSessionId,
    browseWindowOpen: !!browseWindow && !browseWindow.isDestroyed(),
    sessions: [...sessions.entries()].map(([id, s]) => ({ id, channel: s.channel, url: s.url, title: s.title })),
  }
}

async function closeSession(id: string): Promise<boolean> {
  const s = sessions.get(id)
  if (!s) return false
  sessions.delete(id)
  if (activeSessionId === id) {
    const remain = [...sessions.keys()]
    activeSessionId = remain.length ? remain[remain.length - 1] : null
  }
  try {
    await s.browser.close()
  } catch {
    /* 忽略关闭异常 */
  }
  return true
}

export async function stopBrowserAll(): Promise<void> {
  for (const id of [...sessions.keys()]) await closeSession(id)
  if (browseWindow && !browseWindow.isDestroyed()) browseWindow.destroy()
  browseWindow = null
}

// —— 浏览子窗口（浏览模式） ——

let browseWindow: BrowserWindow | null = null

function createBrowseWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'DevWorkbench 浏览器',
    autoHideMenuBar: true,
    webPreferences: {
      // 浏览子窗口不挂 preload：远程页面无法触达 electronAPI 桥
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  win.on('closed', () => {
    browseWindow = null
  })
  return win
}

// —— IPC 注册 ——

export function registerBrowserIpc(): void {
  // 启动（或复用）活跃 headless 会话，可选立即导航
  ipcMain.handle('browser:launch', (_e, url?: string) => ensureAutoSession(url))

  ipcMain.handle('browser:navigate', async (_e, sessionId: string, url: string) => {
    const s = sessions.get(sessionId)
    if (!s) return { success: false, error: '会话不存在或已关闭' }
    const normalized = normalizeUrl(url)
    if (!normalized) return { success: false, error: 'URL 非法（仅支持 http/https）' }
    try {
      await s.page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT })
      s.url = normalized
      s.title = await s.page.title()
      activeSessionId = sessionId
      return { success: true, title: s.title, url: s.url }
    } catch (e) {
      return { success: false, error: errMessage(e) }
    }
  })

  ipcMain.handle('browser:click', async (_e, sessionId: string, selector: string) => {
    const invalid = validateSelector(selector)
    if (invalid) return { success: false, error: invalid }
    const s = sessions.get(sessionId)
    if (!s) return { success: false, error: '会话不存在或已关闭' }
    try {
      await s.page.locator(selector).first().click({ timeout: LOCATOR_TIMEOUT })
      activeSessionId = sessionId
      return { success: true }
    } catch (e) {
      return { success: false, error: `点击失败：${errMessage(e)}` }
    }
  })

  ipcMain.handle('browser:fill', async (_e, sessionId: string, selector: string, value: string) => {
    const invalid = validateSelector(selector)
    if (invalid) return { success: false, error: invalid }
    const s = sessions.get(sessionId)
    if (!s) return { success: false, error: '会话不存在或已关闭' }
    try {
      await s.page.locator(selector).first().fill(value ?? '', { timeout: LOCATOR_TIMEOUT })
      activeSessionId = sessionId
      return { success: true }
    } catch (e) {
      return { success: false, error: `填值失败：${errMessage(e)}` }
    }
  })

  ipcMain.handle('browser:text', async (_e, sessionId: string) => {
    const s = sessions.get(sessionId)
    if (!s) return { success: false, error: '会话不存在或已关闭' }
    try {
      const raw = await s.page.innerText('body', { timeout: 10_000 })
      return { success: true, text: truncateText(compactText(raw), TEXT_MAX) }
    } catch (e) {
      return { success: false, error: `抓取失败：${errMessage(e)}` }
    }
  })

  ipcMain.handle('browser:screenshot', async (_e, sessionId: string) => {
    const s = sessions.get(sessionId)
    if (!s) return { success: false, error: '会话不存在或已关闭' }
    try {
      const buf = await s.page.screenshot({ type: 'png' })
      return { success: true, pngBase64: buf.toString('base64') }
    } catch (e) {
      return { success: false, error: `截图失败：${errMessage(e)}` }
    }
  })

  ipcMain.handle('browser:close', async (_e, sessionId: string) => {
    return { success: await closeSession(sessionId) }
  })

  ipcMain.handle('browser:status', () => statusSnapshot())

  // —— 浏览子窗口 ——

  ipcMain.handle('browser:openBrowseWindow', (_e, rawUrl: string) => {
    const url = normalizeUrl(rawUrl)
    if (!url) return { success: false, error: 'URL 非法（仅支持 http/https）' }
    try {
      if (!browseWindow || browseWindow.isDestroyed()) {
        browseWindow = createBrowseWindow()
      } else {
        browseWindow.focus()
      }
      void browseWindow.loadURL(url)
      return { success: true }
    } catch (e) {
      return { success: false, error: errMessage(e) }
    }
  })

  ipcMain.handle('browser:closeBrowseWindow', () => {
    if (browseWindow && !browseWindow.isDestroyed()) browseWindow.close()
    browseWindow = null
    return { success: true }
  })
}

// —— AI 助手工具集复用（assistant-tools.ts 调用，主进程内直接走会话，不经 IPC） ——

export const browserAssistantApi = {
  ensureAutoSession,
  /** 抓取活跃会话页面压缩文本（AI 阅读，截断 20k 字符） */
  async text(): Promise<{ success: boolean; content?: string; error?: string }> {
    const s = requireActiveSession()
    if (!s) return { success: false, error: '无活跃浏览器会话，请先调用 toolbox_browser_open' }
    try {
      const raw = await s.page.innerText('body', { timeout: 10_000 })
      return { success: true, content: truncateText(compactText(raw), TEXT_MAX) }
    } catch (e) {
      return { success: false, error: `抓取失败：${errMessage(e)}` }
    }
  },
  async click(selector: string): Promise<{ success: boolean; error?: string }> {
    const invalid = validateSelector(selector)
    if (invalid) return { success: false, error: invalid }
    const s = requireActiveSession()
    if (!s) return { success: false, error: '无活跃浏览器会话，请先调用 toolbox_browser_open' }
    try {
      await s.page.locator(selector).first().click({ timeout: LOCATOR_TIMEOUT })
      return { success: true }
    } catch (e) {
      return { success: false, error: `点击失败：${errMessage(e)}` }
    }
  },
  async fill(selector: string, value: string): Promise<{ success: boolean; error?: string }> {
    const invalid = validateSelector(selector)
    if (invalid) return { success: false, error: invalid }
    const s = requireActiveSession()
    if (!s) return { success: false, error: '无活跃浏览器会话，请先调用 toolbox_browser_open' }
    try {
      await s.page.locator(selector).first().fill(value ?? '', { timeout: LOCATOR_TIMEOUT })
      return { success: true }
    } catch (e) {
      return { success: false, error: `填值失败：${errMessage(e)}` }
    }
  },
}
