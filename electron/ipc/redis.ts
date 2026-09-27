// 附录 F F.5：Redis 客户端（ioredis，主进程连接管理 + 命令执行 + SCAN）
// 连接实例常驻 Map（renderer 刷新不丢），命令经白名单协议：字符串解析成参数数组后 client.call。
// 密码只经 connect 参数传入内存，不落盘（存储侧连接列表由 renderer 持久化且不含密码）。
import Redis from 'ioredis'
import { ipcMain } from 'electron'

export interface RedisConnectArgs {
  id: string
  host: string
  port: number
  password?: string
  db?: number
}

/** 值安全上限：超过则截断，防止超大值拖垮渲染层 */
const VALUE_LIMIT = 64 * 1024

/* ---------- 可测纯逻辑 ---------- */

/** 解析命令行为参数数组：空白切分，双引号内允许空格与 \" 转义 */
export function parseRedisCommand(input: string): string[] {
  const args: string[] = []
  let cur = ''
  let inQuote = false
  let hasToken = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inQuote) {
      if (ch === '\\' && input[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuote = false
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') {
      inQuote = true
      hasToken = true
      continue
    }
    if (/\s/.test(ch)) {
      if (hasToken) args.push(cur)
      cur = ''
      hasToken = false
      continue
    }
    cur += ch
    hasToken = true
  }
  if (inQuote) throw new Error('引号未闭合')
  if (hasToken) args.push(cur)
  return args
}

/** ioredis 回复归一化为可 JSON 传输结构（Buffer → utf8，超长截断） */
export function serializeReply(v: unknown): unknown {
  if (Buffer.isBuffer(v)) return truncateStr(v.toString('utf8'))
  if (typeof v === 'string') return truncateStr(v)
  if (Array.isArray(v)) return v.map((x) => serializeReply(x))
  return v
}

function truncateStr(s: string): string {
  return s.length > VALUE_LIMIT ? `${s.slice(0, VALUE_LIMIT)}\n…[截断，总长 ${s.length} 字符]` : s
}

/* ---------- 连接管理 ---------- */

const clients = new Map<string, Redis>()

function createClient(args: RedisConnectArgs): Redis {
  return new Redis({
    host: args.host,
    port: args.port,
    password: args.password || undefined,
    db: args.db ?? 0,
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // 不自动重连，失败直接报错
  })
}

function getClient(id: string): Redis {
  const c = clients.get(id)
  if (!c) throw new Error('该连接未建立，请先连接')
  return c
}

/* ---------- IPC ---------- */

function registerRedisIpc() {
  ipcMain.handle('redis:connect', async (_event, args: RedisConnectArgs) => {
    if (!args?.host) return { success: false, error: '缺少 host' }
    const id = args.id
    const prev = clients.get(id)
    if (prev) {
      void prev.quit()
      clients.delete(id)
    }
    const client = createClient(args)
    try {
      await client.connect()
      const pong = await client.ping()
      if (pong !== 'PONG') throw new Error(`PING 返回异常：${String(pong)}`)
      const info = await client.info('server')
      const version = /redis_version:([\d.]+)/.exec(info)?.[1] ?? '?'
      clients.set(id, client)
      return { success: true, version }
    } catch (e) {
      client.disconnect()
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('redis:exec', async (_event, id: string, command: string) => {
    const startTime = Date.now()
    try {
      const client = getClient(id)
      const args = parseRedisCommand(command)
      if (args.length === 0) return { success: false, error: '空命令' }
      args[0] = args[0].toUpperCase()
      const value = await client.call(...(args as [string, ...string[]]))
      return { success: true, value: serializeReply(value), elapsedMs: Date.now() - startTime }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('redis:scan', async (_event, id: string, cursor: string, match: string, count: number) => {
    try {
      const client = getClient(id)
      const [next, keys] = (await client.scan(
        cursor || '0',
        'MATCH',
        match || '*',
        'COUNT',
        Math.min(Math.max(count || 100, 10), 1000),
      )) as [string, string[]]
      return { success: true, cursor: next, keys }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('redis:disconnect', async (_event, id: string) => {
    const client = clients.get(id)
    if (client) {
      void client.quit()
      clients.delete(id)
    }
    return { success: true }
  })
}

/** 应用退出时清理全部连接 */
async function stopRedisAll(): Promise<void> {
  for (const [, client] of clients) {
    try {
      await client.quit()
    } catch {
      client.disconnect()
    }
  }
  clients.clear()
}

export { registerRedisIpc, stopRedisAll }
