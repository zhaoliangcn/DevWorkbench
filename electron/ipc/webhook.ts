// 附录 F F.3：Webhook 接收器 —— 独立 node:http server（默认 9090，冲突自增）。
// 设计文档原设想复用 API Server 的 Express 实例，但 API Server 是可选功能
// （apiConfig.enabled 才启动），挂载其上会导致 webhook 随之失效，故独立实现。
// 核心行为可测：ringPush（环形 buffer）与 createWebhookHandler（路由 handler）均为纯函数。
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ipcMain, BrowserWindow } from 'electron'

/** 环形 buffer 容量（仅内存，不持久化） */
export const WEBHOOK_BUFFER_MAX = 100
/** body 上限 1MB，超出 413 */
export const WEBHOOK_BODY_LIMIT = 1024 * 1024
/** 首选端口；被占自增（最多试 10 次） */
const PREFERRED_PORT = 9090

export interface WebhookEvent {
  id: string
  method: string
  path: string
  headers: Record<string, string>
  body: string
  receivedAt: number
}

/** 环形插入：超限丢最旧，保持时间序（旧→新） */
export function ringPush<T>(buffer: T[], item: T, max: number = WEBHOOK_BUFFER_MAX): T[] {
  const next = [...buffer, item]
  return next.length > max ? next.slice(next.length - max) : next
}

interface HandlerOptions {
  /** 监听开关：false 时一律 404 */
  isEnabled: () => boolean
  /** 收到请求回调（buffer + 推送 renderer） */
  onEvent: (ev: WebhookEvent) => void
  /** body 上限（测试可调小） */
  bodyLimit?: number
}

/** CORS 全开（接收器本质是接收端，任意来源均可打点） */
function applyCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/** 纯 handler（node:http 签名），供 server 挂载与 vitest 直测 */
export function createWebhookHandler({ isEnabled, onEvent, bodyLimit = WEBHOOK_BODY_LIMIT }: HandlerOptions) {
  return function handle(req: IncomingMessage, res: ServerResponse): void {
    applyCors(res)

    if (!isEnabled()) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Webhook 监听未启用' }))
      return
    }

    // 预检直接 204
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    let aborted = false

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > bodyLimit) {
        aborted = true
        res.statusCode = 413
        res.end(JSON.stringify({ error: `body 超过上限 ${bodyLimit} 字节` }))
        req.removeAllListeners('data')
        req.removeAllListeners('end')
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (aborted) return
      const ev: WebhookEvent = {
        id: genId(),
        method: (req.method ?? 'GET').toUpperCase(),
        path: req.url ?? '/',
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks).toString('utf8'),
        receivedAt: Date.now(),
      }
      onEvent(ev)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ received: true, id: ev.id }))
    })

    req.on('error', () => {
      if (!aborted && !res.writableEnded) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: '请求流错误' }))
      }
    })
  }
}

/* ---------- server 生命周期（模块级单例） ---------- */

let server: http.Server | null = null
let listeningPort: number | null = null
let enabled = false
let buffer: WebhookEvent[] = []

function broadcast(ev: WebhookEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('webhook:received', ev)
  }
}

const handler = createWebhookHandler({
  isEnabled: () => enabled,
  onEvent: (ev) => {
    buffer = ringPush(buffer, ev)
    broadcast(ev)
  },
})

/** 启动 server：EADDRINUSE 自增重试（最多 10 次），返回实际端口 */
export function startWebhookServer(startPort: number = PREFERRED_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(listeningPort!)
      return
    }
    let port = startPort
    let attempts = 0
    const tryListen = (): void => {
      const s = http.createServer(handler)
      s.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempts < 10) {
          attempts++
          port++
          tryListen()
          return
        }
        server = null
        reject(err)
      })
      s.listen(port, '127.0.0.1', () => {
        server = s
        listeningPort = port
        resolve(port)
      })
    }
    tryListen()
  })
}

export function stopWebhookServer(): void {
  if (server) {
    server.close()
    server = null
    listeningPort = null
  }
}

/* ---------- IPC ---------- */

function registerWebhookIpc() {
  ipcMain.handle('webhook:list', () => ({
    listening: Boolean(server),
    port: listeningPort,
    enabled,
    events: buffer,
  }))

  ipcMain.handle('webhook:setEnabled', async (_event, next: boolean) => {
    enabled = Boolean(next)
    try {
      if (enabled && !server) {
        listeningPort = await startWebhookServer()
      } else if (!enabled && server) {
        stopWebhookServer()
        listeningPort = null
      }
    } catch (e) {
      return { listening: Boolean(server), port: listeningPort, enabled: false, error: (e as Error).message }
    }
    return { listening: Boolean(server), port: listeningPort, enabled }
  })

  ipcMain.handle('webhook:clear', () => {
    buffer = []
    return true
  })
}

export { registerWebhookIpc }
