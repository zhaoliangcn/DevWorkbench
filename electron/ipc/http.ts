// 附录 F F.2：HTTP 请求下沉主进程 —— 绕开 renderer CORS，二进制响应 base64 回传。
// Node 22 全局 fetch（内置 undici 实现），零新增依赖。
import { ipcMain } from 'electron'

/** 默认超时 30s（接口调试场景） */
const DEFAULT_TIMEOUT_MS = 30000

/** 响应体硬上限：超大响应不再整体打进主进程内存 */
const MAX_BODY_BYTES = 50 * 1024 * 1024

/** base64 回传的响应类型前缀（其余按 utf8 文本处理） */
const BINARY_TYPE_PREFIXES = [
  'image/',
  'audio/',
  'video/',
  'application/octet-stream',
  'application/pdf',
  'application/zip',
  'application/gzip',
  'application/wasm',
]

export interface HttpRequestArgs {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface HttpResult {
  success: boolean
  status: number | null
  statusText: string
  headers: Record<string, string>
  /** 文本为 utf8 原文；二进制为 base64（bodyIsBase64=true） */
  body: string
  bodyIsBase64: boolean
  durationMs: number
  error?: string
}

/** 判断响应是否按二进制处理 */
export function isBinaryContent(contentType: string | null): boolean {
  if (!contentType) return false
  const ct = contentType.toLowerCase().split(';')[0].trim()
  return BINARY_TYPE_PREFIXES.some((p) => ct.startsWith(p))
}

/** 分块读取响应体并施加硬上限，超限抛错中止（导出供测试） */
export async function readBodyWithLimit(res: Response, limit: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > limit) throw new Error(`响应体超过 ${limit / 1024 / 1024}MB 上限（content-length: ${declared}）`)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > limit) {
      await reader.cancel()
      throw new Error(`响应体超过 ${limit / 1024 / 1024}MB 上限`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/** timeoutMs 夹取到 1s~60s（非法/缺省回退默认值） */
export function clampTimeoutMs(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(60000, Math.max(1000, n))
}

/** 纯 handler（不挂 ipcMain），便于 vitest 直接调用 */
export async function httpRequestHandler(args: HttpRequestArgs): Promise<HttpResult> {
  const startTime = Date.now()
  const url = String(args?.url ?? '').trim()
  if (!url) {
    return { success: false, status: null, statusText: '', headers: {}, body: '', bodyIsBase64: false, durationMs: 0, error: '缺少 url' }
  }
  try {
    // URL 合法性校验（同时拒绝 file:/data: 等非 http 协议）
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, status: null, statusText: '', headers: {}, body: '', bodyIsBase64: false, durationMs: Date.now() - startTime, error: `不支持的协议: ${parsed.protocol}` }
    }
  } catch {
    return { success: false, status: null, statusText: '', headers: {}, body: '', bodyIsBase64: false, durationMs: Date.now() - startTime, error: 'URL 格式非法' }
  }

  const method = String(args.method ?? 'GET').toUpperCase()
  const timeoutMs = clampTimeoutMs(args.timeoutMs)

  try {
    const res = await fetch(url, {
      method,
      headers: args.headers,
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? args.body : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      // redirect:'follow' 会跟随包括 https→http 在内的所有重定向（undici 默认行为）。
      // 本工具面向任意目标的接口调试，接受此行为；响应体经 readBodyWithLimit 施加硬上限。
      redirect: 'follow',
    })

    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })

    const contentType = res.headers.get('content-type')
    if (isBinaryContent(contentType)) {
      const buf = Buffer.from(await readBodyWithLimit(res, MAX_BODY_BYTES))
      return {
        success: true,
        status: res.status,
        statusText: res.statusText,
        headers,
        body: buf.toString('base64'),
        bodyIsBase64: true,
        durationMs: Date.now() - startTime,
      }
    }

    const text = Buffer.from(await readBodyWithLimit(res, MAX_BODY_BYTES)).toString('utf8')
    return {
      success: true,
      status: res.status,
      statusText: res.statusText,
      headers,
      body: text,
      bodyIsBase64: false,
      durationMs: Date.now() - startTime,
    }
  } catch (e) {
    const err = e as Error
    const msg = err.name === 'TimeoutError' ? `请求超时（>${timeoutMs}ms）` : err.message
    return {
      success: false,
      status: null,
      statusText: '',
      headers: {},
      body: '',
      bodyIsBase64: false,
      durationMs: Date.now() - startTime,
      error: msg,
    }
  }
}

function registerHttpIpc() {
  ipcMain.handle('http:request', (_event, args: HttpRequestArgs) => httpRequestHandler(args))
}

export { registerHttpIpc }
